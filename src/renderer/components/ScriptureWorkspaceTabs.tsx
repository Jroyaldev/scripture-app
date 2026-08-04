import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  type WorkspaceReorderPosition,
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

/* RE-EXPORTED, NOT RESTATED. This was a fourth copy of the model's vocabulary —
   the model, this file, ScripturePage and app.tsx each spelled the same union
   out, which is why widening it for the drag failed to compile in three places
   at once. One declaration, in the file that acts on it. */
export type { WorkspaceReorderPosition };

/** Pointer travel (px) before a press on a tab becomes a reorder drag. */
const DRAG_THRESHOLD_PX = 4;

/** The All Tabs panel's id — the trigger's `aria-controls`, and the anchor the
 *  keyboard walk asks the document for. Named once so the two cannot drift. */
const OVERFLOW_PANEL_ID = "study-workspace-all-tabs";

/** How long a typed word stays in progress inside the open menu. The platform
 *  idiom: long enough to spell a name at a human pace, short enough that coming
 *  back a moment later starts a fresh one. */
const TYPE_AHEAD_RESET_MS = 700;

export interface ScriptureWorkspaceTabsProps {
  workspace: StudyWorkspaceStateV2;
  bookNames: BookNameData;
  onSelect: (tabId: string) => Promise<boolean>;
  onClose: (tabId: string) => Promise<boolean>;
  onCloseGroup: (groupId: string) => Promise<boolean>;
  onRenameGroup: (groupId: string, label: string) => Promise<boolean>;
  /** `slot` is where in the target study to land, and only a drag knows it: a
   *  menu naming a study has said nothing about position, so it omits this and
   *  the model appends. */
  onMoveTab: (tabId: string, targetGroupId: string, slot?: number) => Promise<boolean>;
  onPromoteTab: (tabId: string) => Promise<boolean>;
  /**
   * The study a dragged tab is currently over, or null.
   *
   * The targets belong to the study control at the end of this row and are
   * rendered by another component, so the strip reports what its own pointer is
   * over and that component paints it. It is deliberately NOT an intent: nothing
   * is committed by hovering, so this one callback is void where every mutation
   * here returns an approval.
   */
  onTabDragOverStudy: (groupId: string | null) => void;
  /**
   * What the drag is currently doing, or null when there is none.
   *
   * Separate from `onTabDragOverStudy` because null there means "over no study",
   * which is true both during a drag and when there is no drag at all. Reported
   * at the DRAG THRESHOLD rather than at pointerdown, so a plain click on a tab
   * never reaches the study control.
   *
   * IT IS A PHASE AND NOT A BOOLEAN as of 2026-08-03, because two different
   * things wanted it. The list used to open the moment any drag began — so
   * sliding a tab two places along its own row hung a 252px panel off the study
   * control, which is noise about a decision the reader is not making. In
   * REORDER the control says only that it is somewhere a tab can be taken; the
   * list opens on CARRY, when the tab has actually left the row.
   */
  onTabDragPhase: (phase: "reorder" | "carry" | null, tabId: string | null) => void;
  /**
   * The study control, rendered into this row rather than constructed by it.
   *
   * It is a slot for one reason: layout. The control right-aligns at the end of
   * the register beside the cluster that reports on tabs, and that is a fact
   * about THIS row's flexbox — a sibling positioned over the row would have to
   * measure a cluster whose width changes with the save status. The strip holds
   * the node and knows nothing about studies; every prop it needs is passed
   * where the rest of the workspace props are.
   */
  studies?: React.ReactNode;
  onReorderTab: (tabId: string, position: WorkspaceReorderPosition) => Promise<boolean>;
  onReorderGroup: (groupId: string, position: WorkspaceReorderPosition) => Promise<boolean>;
  onReopenRecent: () => Promise<boolean>;
  onReopenRecentItem: (index: number) => Promise<boolean>;
  /**
   * Forget every retained recently-closed entry.
   *
   * Void where its neighbours return an approval, because there is nothing to
   * approve: clearing a list can only remove, and the reversal it offers is a
   * toast rather than a refusal this surface has to react to.
   */
  onClearRecent: () => void;
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
  /** How far each OTHER tab has stepped aside to open the slot, in pixels. */
  shifts: Map<string, number>;
  /**
   * REORDER while the tab is still in its row; CARRY once it has left.
   *
   * They are two different gestures wearing one pointer. In the row the tab is
   * being placed among its siblings and the run answers by opening a slot. Off
   * the row it is being taken somewhere — to another study — and the run has no
   * answer to give: it closes back up, the tab leaves it, and what the reader is
   * holding rides the cursor instead.
   */
  phase: "reorder" | "carry";
}

/** How far past the register's own row a pointer may stray and still be in it. */
const CARRY_SLACK_PX = 14;

/** One tab's box as it stood when the drag began. */
export interface TabSlot {
  id: string;
  left: number;
  width: number;
}

/**
 * WHERE THE RUN GOES WHEN A TAB IS LIFTED OUT OF IT.
 *
 * The register used to answer "where will it land" with a 2px rule standing
 * between two tabs. That is the browser idiom this design was drawn to refuse,
 * and the maintainer read it as what it is — a vertical line appearing at an
 * arbitrary edge, with nothing on screen responding to the gesture making it.
 * So the tabs answer instead: pass a neighbour's middle and it moves aside, and
 * the gap that opens IS the slot. Nothing is drawn that was not already there.
 *
 * THE MEASUREMENTS ARE A SNAPSHOT AND MUST BE. The old midpoint loop read live
 * rects every frame, which is correct only while nothing moves; the moment a
 * sibling slides aside its live rect is somewhere the layout never put it, and
 * the next frame measures the consequence of the last one. That is a feedback
 * loop, and it reads as tabs shuddering under the pointer. Every number here
 * comes from the run as it stood at the threshold.
 *
 * AND THE SHIFT IS A POSITIONAL DELTA, never a constant. Tabs are 2px apart —
 * except across the SELECTED tab, which carries `margin-inline: 14px` to reserve
 * its fillets' footprint, and drops the start side of that at `[data-flush-start]`.
 * So a run's gaps are genuinely uneven, and a sibling asked to move "one tab
 * width" would land between two slots. What a sibling steps by is the distance
 * between the two snapshot positions it is stepping between, which is exact
 * whatever the margins are doing.
 *
 * Returns the insertion index in the ORIGINAL ordering (what
 * `studyWorkspaceDragReorderPosition` expects) and the per-tab shift in pixels.
 */
export function studyWorkspaceDragShuffle(
  slots: readonly TabSlot[],
  draggedIndex: number,
  draggedCenter: number,
): { insertionIndex: number; shifts: Map<string, number> } {
  const shifts = new Map<string, number>();
  const dragged = slots[draggedIndex];
  if (!dragged) return { insertionIndex: draggedIndex, shifts };

  /* The slot the pointer is over: the last one whose middle the dragged tab's
     centre has passed. Walking rather than searching keeps the rule readable —
     "past half way" is stated once, in the comparison. */
  let target = draggedIndex;
  while (target > 0) {
    const before = slots[target - 1]!;
    if (draggedCenter >= before.left + before.width / 2) break;
    target -= 1;
  }
  while (target < slots.length - 1) {
    const after = slots[target + 1]!;
    if (draggedCenter <= after.left + after.width / 2) break;
    target += 1;
  }

  /* Everything between the tab's old slot and its new one steps over by one
     slot, in the direction that opens the gap. The step is the difference
     between the two snapshot lefts, which is what makes it exact under uneven
     margins — see the note above. */
  if (target < draggedIndex) {
    for (let index = target; index < draggedIndex; index += 1) {
      shifts.set(slots[index]!.id, slots[index + 1]!.left - slots[index]!.left);
    }
  } else if (target > draggedIndex) {
    for (let index = draggedIndex + 1; index <= target; index += 1) {
      shifts.set(slots[index]!.id, slots[index - 1]!.left - slots[index]!.left);
    }
  }

  /* AND THE INDEX IS CONVERTED HERE rather than in the helper that consumes it.
     `target` is the SLOT the tab ends up in; `studyWorkspaceDragReorderPosition`
     takes "insert before index i" in the run as it stands, dragged tab included,
     and subtracts one itself when the insertion is to the right. The two are the
     same fact counted from opposite ends, and the conversion belongs on this
     side: that helper is shared with the keyboard path and its arithmetic has
     its own contract. A shuffle that redefined its argument would be a change to
     reordering, dressed as a change to a drop indicator. */
  return {
    insertionIndex: target >= draggedIndex ? target + 1 : target,
    shifts,
  };
}

/**
 * The study under a dragged tab, if the pointer has left the tabs for one.
 *
 * Hit-testing the document rather than listening for pointer events on the
 * target is not a shortcut: the drag sets pointer capture on the tab so the
 * gesture survives leaving the strip, and a captured pointer sends its events to
 * the capturing element — a target never sees one. `elementFromPoint` asks the
 * question capture cannot answer, and asks it of the DOM the reader can see.
 *
 * RESTATED 2026-08-03, when the studies stopped being a row of chips above the
 * strip and became one control at its end. The targets are the rows of that
 * control's list, which is open for the length of a drag precisely so that they
 * exist to be dropped on — see StudyControl. Nothing about the mechanism changed
 * and that is the point of the attribute: what is hit-tested is "a thing that
 * stands for a study", not "a chip in a row that no longer exists".
 *
 * A target standing for the tab's OWN study is not a target: dropping a tab back
 * where it already is has no move to make, and lighting it would promise one.
 */
/**
 * THE ROW THAT IS NOT A STUDY YET.
 *
 * "Start a new study" is a destination for a carried tab exactly as every other
 * row is — Safari's drag-a-tab-out-to-a-new-window, mapped onto studies — and
 * the mutation it needs already exists, as the tab menu's "New study from this
 * tab". What it does not have is a group id, because the group is what the drop
 * would create.
 *
 * So it borrows one. A sentinel travels every pipe the real ids travel — the
 * hit-test, the strip's report, the control's landing paint — and is read back
 * at exactly one place, the drop. Nothing between them needs to know, which is
 * the point: a second callback for "and also this row" would be a second drag
 * gesture to keep in step with the first.
 *
 * It is a string no group id can collide with. Group ids are uuids.
 */
export const START_STUDY_TARGET = "start-a-new-study";

export function studyDropTargetId(
  element: Element | null,
  sourceGroupId: string,
): string | null {
  const target = element?.closest("[data-study-target]");
  const groupId = target?.getAttribute("data-study-group-id") ?? null;
  return groupId && groupId !== sourceGroupId ? groupId : null;
}

/**
 * WHAT THE READER IS HOLDING, once the tab has left the row.
 *
 * A drag that reaches the study list used to dim the tab in place and leave the
 * cursor over a menu with nothing in it. The maintainer put it exactly: "you
 * lose clear handling when you enter menu" — there was no longer anything on
 * screen saying a tab was still in hand, or that the rows under the pointer
 * would take it.
 *
 * So the tab comes with. It is a proxy rather than the tab itself because the
 * tab belongs to a row that is closing up behind it, and because a fixed layer
 * can be over the study list while a flex child of the strip can never be.
 *
 * It is DELIBERATELY PLAIN. Paper, the register's own type, and the same pair of
 * shadows a lifted tab already casts — no seal, no tint, no scale. The premium
 * sweep forbids a gold fill wider than a mark, and a proxy that arrived in the
 * app's authorship ink would be claiming the drag had already done something.
 */
interface CarriedTab {
  id: string;
  label: string;
  kind: string;
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

/**
 * Which row a reader means when they type into an open menu.
 *
 * THIS REPLACES A SEARCH FIELD, and the difference is the whole point. A field
 * asks the reader to aim at it, spends the tallest element in the panel saying
 * so, and answers by HIDING things — which is a fine bargain over a thousand
 * results and a poor one over four rows the reader can already see. A menu
 * answers the same intent by moving: every row stays where it was, and the one
 * you named takes focus. That is what every native menu on this platform does
 * with a keystroke, and readers arrive already knowing it.
 *
 * Prefix beats word-boundary, and it beats it by RETURNING FIRST rather than by
 * scoring: typing "j" should land on "John 2" before "1 John 2", because a
 * reader spelling a name starts at its start. The boundary pass is what makes
 * "john" reach "1 John 2" at all, and what lets a bare "3" reach "Matthew 3" —
 * chapter numbers are the other half of how these rows are named.
 */
export function studyWorkspaceTypeAheadIndex(
  labels: readonly string[],
  buffer: string,
): number {
  const needle = buffer.trim().toLocaleLowerCase();
  if (needle.length === 0) return -1;
  let wordBoundary = -1;
  for (let index = 0; index < labels.length; index += 1) {
    const label = (labels[index] ?? "").toLocaleLowerCase();
    if (label.startsWith(needle)) return index;
    if (wordBoundary < 0 && label
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => word.length > 0 && word.startsWith(needle))) {
      wordBoundary = index;
    }
  }
  return wordBoundary;
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
  /* THE SLOT, NOT A DIRECTION · 2026-08-03. This returned "left"/"right" for
     anything that was not an end-stop, and those words mean ONE STEP — so the
     first tab dragged to the fourth slot arrived second, having been asked to
     move right, once. The reader had just watched the run open the fourth slot
     and the tab went somewhere else.

     It looked like a middle-of-the-run bug because the extremes were fine:
     "start" and "end" are absolute and say the whole answer. The middles were
     the only place the vocabulary lost the number. */
  return { slot: destination };
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

/* WHAT A KIND OF TAB LOOKS LIKE, decided once.
   Split from `TabMark` on 2026-08-03 so the carried proxy can ask the same
   question the tab asks. It takes the kind rather than the tab because the proxy
   has left the model behind — it is standing for what is on screen — and two
   functions drawing the same four marks is two chances to disagree about them. */
function TabMarkForKind({ kind }: { kind: string }): React.JSX.Element {
  if (kind === "passage") return <span className="scripture-workspace-tab-mark is-passage" aria-hidden="true"><PassageGlyph /></span>;
  if (kind === "person") return <span className="scripture-workspace-tab-mark is-person" aria-hidden="true"><PersonGlyph /></span>;
  if (kind === "place") return <span className="scripture-workspace-tab-mark is-place" aria-hidden="true"><PlaceGlyph /></span>;
  return <span className="scripture-workspace-tab-mark" aria-hidden="true" />;
}

function TabMark({ tab }: { tab: StudyWorkspaceTab }): React.JSX.Element {
  return <TabMarkForKind kind={studyWorkspaceTabType(tab)} />;
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

/* The menu offers the four STEPS and no slot, which is the whole point of the
   distinction: a menu item is a named move — "move earlier" — while a drag is a
   place. Typed to the words alone so the key below is a string, and so that a
   slot can never be added here without someone deciding what to call it. */
const REORDER_MENU_LABELS: ReadonlyArray<{ position: "left" | "right" | "start" | "end"; label: string }> = [
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
  onTabDragPhase,
  studies,
  onReorderTab,
  onReorderGroup,
  onReopenRecent,
  onReopenRecentItem,
  onClearRecent,
  onDuplicateTab,
  onNewResearch,
  persistenceStatus,
  onRetryPersistence,
}: ScriptureWorkspaceTabsProps): React.JSX.Element {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<DOMRect | null>(null);
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
  /* The proxy is STATE because it appears and disappears, and its POSITION is a
     ref because it changes every frame — the same division the dragged tab's own
     offset makes one field up, for the same reason. */
  const [carried, setCarried] = useState<CarriedTab | null>(null);
  const carriedRef = useRef<HTMLDivElement>(null);
  /* WHERE THE POINTER WAS ON THE FRAME THE PROXY APPEARED.
     The proxy is mounted by a render, and the render happens AFTER the move that
     decided to mount it — so on its first frame the ref the position is written
     through does not exist yet, and the card paints at the document's top-left
     corner before the next move corrects it. A flash in the opposite corner of
     the screen from the thing the reader is dragging. This carries the last
     coordinates across that one frame; the layout effect below spends them. */
  const carriedAtRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  /* Where the caret lands when All Tabs opens. Assigned during the row loop, so
     it is committed before Popover's focus task runs — the panel does not exist
     until the pass that measures it, and the children mount on that same
     pass. */
  const activeOverflowRowRef = useRef<HTMLButtonElement>(null);
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
      /** The button the gesture began on. Kept because the drop still wants a
       *  focus target and a capture to release, and by then the pointer may be
       *  anywhere — including over nothing this component owns. */
      node: HTMLButtonElement | null;
      pointerId: number;
      /** The run as it stood when the gesture became a drag. See the shuffle. */
      slots: TabSlot[];
      draggedIndex: number;
      phase: "reorder" | "carry";
      /** The register's own row, snapshotted, so leaving it is a fixed test. */
      band: { top: number; bottom: number };
    } | null
  >(null);
  /* WHERE THE DRAGGED TAB WAS LAST SEEN, kept for the settle.
     A drop commits a reorder, React re-lays the run out, and the tab would
     otherwise appear in its new slot with no travel between the two — the one
     moment in the gesture where the app knows exactly where the reader is
     looking and says nothing. This holds the visual left across the commit so
     the layout effect below can play the difference back. */
  const tabDragListenersRef = useRef<(() => void) | null>(null);
  const settleRef = useRef<{ tabId: string; left: number } | null>(null);
  const suppressTabClickRef = useRef(false);

  /* ── DRAGGING A ROW INSIDE ALL TABS ────────────────────────────────────────

     The strip's drag and this one look alike and are not the same gesture, and
     the difference is worth stating before the code:

       · THE AXIS. The strip is a row; this is a list. Everything the strip
         reasons about in `left`/`width` this reasons about in `top`/`height`.
       · THE COORDINATE SPACE. The strip snapshots viewport rects once and never
         scrolls. This list scrolls WHILE you drag — auto-scroll is the whole
         reason you can reach a study below the fold — so viewport snapshots go
         stale the first frame the list moves. Everything here is in the list's
         CONTENT space: `top + scrollTop` at capture, and the pointer converted
         with the live `scrollTop` every frame.
       · THE SHIFT. `studyWorkspaceDragShuffle` exists because the strip's
         selected tab carries uneven margins, so how far each neighbour moves is
         a positional question with no closed form. These rows are uniform —
         28px and a 2px gap — so a neighbour moves exactly one step or not at
         all, and the arithmetic is a comparison rather than a walk. It also
         assumes the dragged item is IN the slot list, which is false the moment
         the target is a different study.

     What is shared is the discipline, and it is the part that was expensive to
     learn: snapshot once at threshold, write per-frame transforms straight to
     the DOM, and only set React state when a DISCRETE value changes. */
  interface RowDragRow { id: string; groupId: string; top: number; height: number }
  interface RowDragGesture {
    x: number;
    y: number;
    tabId: string;
    groupId: string;
    started: boolean;
    rows: RowDragRow[];
    sections: Array<{ groupId: string; top: number; bottom: number }>;
    step: number;
    listTop: number;
    listHeight: number;
    pointerX: number;
    pointerY: number;
    target: { groupId: string; slot: number } | null;
  }
  const rowDragRef = useRef<RowDragGesture | null>(null);
  const rowGhostRef = useRef<HTMLDivElement>(null);
  const rowScrollRafRef = useRef<number | null>(null);
  const suppressRowClickRef = useRef(false);
  const [rowDrag, setRowDrag] = useState<
    { tabId: string; groupId: string; targetGroupId: string; slot: number } | null
  >(null);
  const [rowCarried, setRowCarried] = useState<CarriedTab | null>(null);
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
  /* NOTHING IS FILTERED ANY MORE. `filteredGroups` stood here and rebuilt the
     whole list on every keystroke, hiding rows that did not match. That is the
     right trade over a thousand results and the wrong one over a list a reader
     can see all of: it takes a stable set of rows whose positions they were
     learning and makes it a different list each character. Typing now moves
     focus instead — `handleOverflowTypeAhead` — and every row stays put. */
  const recentlyClosed = workspace.recentlyClosed.at(-1);
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

  /* The fallback may be a ref or a lookup. Four of these sites used to name the
     search field, not because the field was the right place to land but because
     it was the only thing in the panel guaranteed to still be there — the header
     rebuilds under its new name after a rename, the row remounts in its new
     study after a move. With the field gone the honest answer is the PANEL
     itself, which is focusable for exactly this reason and keeps the reader
     inside the dialog they opened; and a panel that only exists while open has
     to be looked up when the timer fires, not captured when it is scheduled. */
  const scheduleControlFocus = useCallback((
    requested: HTMLElement | null,
    fallback: React.RefObject<HTMLElement | null> | (() => HTMLElement | null),
  ): void => {
    window.setTimeout(() => {
      const spare = typeof fallback === "function" ? fallback() : fallback.current;
      const target = requested?.isConnected ? requested : spare;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  const overflowPanelFallback = useCallback(
    (): HTMLElement | null => document.getElementById(OVERFLOW_PANEL_ID),
    [],
  );

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
    options: { keepOverflow?: boolean } = {},
  ): void => {
    event.preventDefault();
    setMenu(null);
    /* A menu raised from the STRIP dismisses the overview, because the reader
       has gone back to the tabs. One raised from a row inside the overview does
       not: they are managing a list, and closing the list to offer them one row's
       verbs would end the job they are in the middle of. */
    if (!options.keepOverflow) setOverflowOpen(false);
    contextTriggerRef.current = event.currentTarget;
    setContextMenu({ target, anchor: new DOMRect(event.clientX, event.clientY, 0, 0) });
  }, []);

  /* ── WALKING THE LIST ──────────────────────────────────────────────────────

     Every stop in the overview that answers Enter with a place to go: the tab
     rows in study order, then the recently-closed items. One sequence, because
     to a reader looking for a chapter they are one list — the fact that half of
     them are open and half are recoverable is a property of the rows, not a
     reason to make the arrow keys stop in the middle.

     Read from the DOM rather than assembled from state, and deliberately: what
     the arrows should travel is what is ON SCREEN, in the order the sections put
     it. A parallel model of that ordering is a second thing to keep in step with
     the render.

     ANCHORED ON THE PANEL, not on the list. This used to climb from the search
     input to `.popover-panel`, which was convenient and wrong in a way that only
     showed when the field left: the recents are a SIBLING of the list, so an
     anchor inside the list quietly drops half the sequence. The panel carries an
     id already — it is what the trigger's `aria-controls` names — so ask for it
     by the name the markup publishes. */
  const overflowStops = useCallback((): HTMLButtonElement[] => {
    const panel = document.getElementById(OVERFLOW_PANEL_ID);
    if (!panel) return [];
    return [...panel.querySelectorAll<HTMLButtonElement>(
      "[data-study-all-tabs-row] > button, [data-study-recent-item]",
    )];
  }, []);

  /* `from` is where the reader is; `delta` is the step. There is nothing above
     the first stop any more — the field that used to sit there is gone, and a
     wrap to the bottom would be a reader asking to go up and being sent to the
     end. ArrowUp at the top stops, which is what a menu does. */
  const moveOverflowFocus = useCallback((from: number, delta: number): void => {
    const stops = overflowStops();
    if (stops.length === 0) return;
    const target = stops[Math.max(0, Math.min(stops.length - 1, from + delta))];
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }, [overflowStops]);

  /* ── TYPING, WITHOUT A FIELD ───────────────────────────────────────────────

     The buffer is a ref rather than state on purpose: nothing renders from it.
     A menu that echoed what you were typing back at you would be a search field
     again, drawn worse — what a reader wants to see is the row they named taking
     focus, and they see that already. Seven hundred milliseconds is the platform
     idiom: long enough to spell "matt" at a human pace, short enough that coming
     back to the menu a moment later starts a fresh word.

     Bound on the PANEL, not the list, for two reasons that pull the same way:
     the recents live outside the list, and the group rename form lives INSIDE it
     with a text field a reader must be able to type into. Hence the guards — a
     keystroke aimed at a text field belongs to that field, a chord belongs to
     whatever owns the chord, and a bare Space is a button being pressed until
     there is a word in progress for it to extend. */
  const typeAheadRef = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const handleOverflowTypeAhead = useCallback((event: KeyboardEvent): boolean => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.length !== 1) return false;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return false;
    const record = typeAheadRef.current;
    const fresh = event.timeStamp - record.at > TYPE_AHEAD_RESET_MS;
    if (event.key === " " && (fresh || record.buffer.length === 0)) return false;
    const buffer = (fresh ? "" : record.buffer) + event.key;
    typeAheadRef.current = { buffer, at: event.timeStamp };
    const stops = overflowStops();
    const index = studyWorkspaceTypeAheadIndex(
      stops.map((stop) => stop.textContent ?? ""),
      buffer,
    );
    if (index < 0) return true;
    moveOverflowFocus(index, 0);
    return true;
  }, [moveOverflowFocus, overflowStops]);

  const handleOverflowKeyDown = useCallback((event: KeyboardEvent): void => {
    const stops = overflowStops();
    const index = stops.indexOf(event.target as HTMLButtonElement);
    if (index >= 0) {
      if (event.key === "ArrowDown") moveOverflowFocus(index, 1);
      else if (event.key === "ArrowUp") moveOverflowFocus(index, -1);
      else if (event.key === "Home") moveOverflowFocus(0, 0);
      else if (event.key === "End") moveOverflowFocus(stops.length - 1, 0);
      else if (handleOverflowTypeAhead(event)) { /* focus moved or no match */ }
      else return;
      event.preventDefault();
      return;
    }
    // Off a row — the head, a section header, the gaps. Typing still aims at the
    // list, so a reader who opened the menu and typed does not have to find a
    // row first to be understood.
    if (handleOverflowTypeAhead(event)) event.preventDefault();
  }, [handleOverflowTypeAhead, moveOverflowFocus, overflowStops]);

  /* Bound on the PANEL rather than on the rows, which is the shape the surface
     actually has: the recents sit outside the list, the head sits above it, and
     a reader who opens the menu and starts typing should be understood wherever
     focus happens to be. One listener on the element that contains all of it
     says that once. It is native rather than a React prop because the panel is
     Popover's element, not this component's — and because the same lookup that
     anchors the walk can hand it over. */
  useEffect(() => {
    if (!overflowOpen) return;
    typeAheadRef.current = { buffer: "", at: 0 };
    /* Bound on the DOCUMENT, then filtered to the panel — not bound on the
       panel, which is the version that looked right and did nothing. Popover
       measures before it renders, so the element this listener wants does not
       exist on the pass where `overflowOpen` becomes true; an effect that
       reaches for it by id finds null, returns, and never runs again, because
       nothing it depends on changes when the panel finally mounts. The document
       is always there, and the containment check is the same question the
       narrower binding was asking implicitly. */
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`#${OVERFLOW_PANEL_ID}`)) return;
      handleOverflowKeyDown(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleOverflowKeyDown, overflowOpen]);

  /* Popover focuses with `preventScroll: true`, which is right for a field at
     the top of a panel and wrong for a row that may be forty tabs down: the
     menu would open on its first study with the caret somewhere below the fold
     and nothing to show for it. */
  useEffect(() => {
    if (!overflowOpen) return;
    const timer = window.setTimeout(() => {
      activeOverflowRowRef.current?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [overflowOpen, overflowAnchor]);

  /** The list a row drag lives inside, or null when the panel is closed. */
  const overflowListElement = useCallback((): HTMLElement | null => (
    document.getElementById(OVERFLOW_PANEL_ID)
      ?.querySelector<HTMLElement>(".scripture-workspace-overflow-list") ?? null
  ), []);

  /* Where a pointer at content-space `y` is asking to put the row.
     The slot is stated in KEPT-LIST space — the study's rows with the dragged
     one taken out — because that is what both mutations mean by it: `reorderedIndex`
     splices the tab out and then in, and `moveTabRecords` inserts among the tabs
     it kept. Two vocabularies for one number is how a preview and a commit come
     to disagree. */
  const rowDropTarget = useCallback((
    gesture: RowDragGesture,
    y: number,
  ): { groupId: string; slot: number } | null => {
    const section = gesture.sections.find((entry) => y >= entry.top && y <= entry.bottom)
      // Above the first section or below the last: the nearest one, so a reader
      // who overshoots into the head or the recents still has an answer rather
      // than watching the gap snap shut.
      ?? (y < (gesture.sections[0]?.top ?? 0)
        ? gesture.sections[0]
        : gesture.sections.at(-1));
    if (!section) return null;
    const kept = gesture.rows.filter((row) => row.groupId === section.groupId
      && row.id !== gesture.tabId);
    let slot = kept.length;
    for (let index = 0; index < kept.length; index += 1) {
      const row = kept[index];
      if (row && y < row.top + row.height / 2) { slot = index; break; }
    }
    return { groupId: section.groupId, slot };
  }, []);

  /* One step down, one step up, or nothing. Rows the drop pushes past move by
     exactly `step`; everything else stays. Written against the ORIGINAL rendered
     order, because that is what is on screen — the arithmetic converts each row's
     original index to where it will end up and takes the difference. */
  const rowDragShifts = useCallback((
    gesture: RowDragGesture,
    target: { groupId: string; slot: number },
  ): Map<string, number> => {
    const shifts = new Map<string, number>();
    const source = gesture.rows.filter((row) => row.groupId === gesture.groupId);
    const from = source.findIndex((row) => row.id === gesture.tabId);
    if (from < 0) return shifts;
    if (target.groupId === gesture.groupId) {
      source.forEach((row, index) => {
        if (row.id === gesture.tabId) return;
        // Below the dragged row and at or before the slot: it comes up one.
        // Above it and at or after the slot: it goes down one.
        if (index > from && index - 1 < target.slot) shifts.set(row.id, -gesture.step);
        else if (index < from && index >= target.slot) shifts.set(row.id, gesture.step);
      });
      return shifts;
    }
    // Two studies: the source closes over the hole, the target opens one.
    source.forEach((row, index) => {
      if (index > from) shifts.set(row.id, -gesture.step);
    });
    gesture.rows
      .filter((row) => row.groupId === target.groupId)
      .forEach((row, index) => {
        if (index >= target.slot) shifts.set(row.id, gesture.step);
      });
    return shifts;
  }, []);

  const paintRowDrag = useCallback((gesture: RowDragGesture): void => {
    const list = overflowListElement();
    if (!list) return;
    const y = gesture.pointerY - gesture.listTop + list.scrollTop;
    const ghost = rowGhostRef.current;
    // Both axes. This tracked Y alone at first, which left the proxy pinned to
    // the left edge of the WINDOW while the row it represented was being carried
    // down a panel eleven hundred pixels to the right — a ghost that is not
    // under the cursor is not a ghost of anything.
    if (ghost) {
      ghost.style.transform =
        `translate3d(${Math.round(gesture.pointerX + 12)}px, ${Math.round(gesture.pointerY - 14)}px, 0)`;
    }
    const target = rowDropTarget(gesture, y);
    const shifts = target ? rowDragShifts(gesture, target) : new Map<string, number>();
    for (const row of gesture.rows) {
      const element = list.querySelector<HTMLElement>(
        `[data-study-all-tabs-row][data-study-tab-id="${CSS.escape(row.id)}"]`,
      );
      if (!element) continue;
      const shift = shifts.get(row.id) ?? 0;
      element.style.setProperty("--row-shift", `${shift}px`);
    }
    // Only when a discrete value changes — a render per frame would fight the
    // transforms this just wrote.
    const changed = target?.groupId !== gesture.target?.groupId
      || target?.slot !== gesture.target?.slot;
    gesture.target = target;
    if (changed) {
      setRowDrag(target
        ? { tabId: gesture.tabId, groupId: gesture.groupId, targetGroupId: target.groupId, slot: target.slot }
        : null);
    }
  }, [overflowListElement, rowDragShifts, rowDropTarget]);

  /* AUTO-SCROLL, and the reason the coordinates are what they are. Sixty-four
     tabs do not fit; the study you want may be below the fold; so nearing an
     edge with a row in hand scrolls the list. Every scroll moves the rows under
     the pointer, which is exactly why the snapshot is in content space and the
     pointer is converted fresh each frame. */
  const stepRowScroll = useCallback((): void => {
    const gesture = rowDragRef.current;
    const list = overflowListElement();
    if (!gesture?.started || !list) { rowScrollRafRef.current = null; return; }
    const above = gesture.pointerY - gesture.listTop;
    const below = gesture.listTop + gesture.listHeight - gesture.pointerY;
    const EDGE = 28;
    const speed = above < EDGE ? -Math.min(12, EDGE - above)
      : below < EDGE ? Math.min(12, EDGE - below)
        : 0;
    if (speed !== 0) {
      const before = list.scrollTop;
      list.scrollTop += speed;
      if (list.scrollTop !== before) paintRowDrag(gesture);
    }
    rowScrollRafRef.current = window.requestAnimationFrame(stepRowScroll);
  }, [overflowListElement, paintRowDrag]);

  const endRowDrag = useCallback((): void => {
    const list = overflowListElement();
    if (list) {
      list.removeAttribute("data-row-drag-live");
      for (const element of list.querySelectorAll<HTMLElement>("[data-study-all-tabs-row]")) {
        element.style.removeProperty("--row-shift");
      }
    }
    if (rowScrollRafRef.current !== null) {
      window.cancelAnimationFrame(rowScrollRafRef.current);
      rowScrollRafRef.current = null;
    }
    rowDragRef.current = null;
    setRowDrag(null);
    setRowCarried(null);
  }, [overflowListElement]);

  const handleRowPointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: string,
    groupId: string,
  ): void => {
    if (event.button !== 0) return;
    rowDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      tabId,
      groupId,
      started: false,
      rows: [],
      sections: [],
      step: 0,
      listTop: 0,
      listHeight: 0,
      pointerX: event.clientX,
      pointerY: event.clientY,
      target: null,
    };
  }, []);

  const handleRowPointerMove = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const gesture = rowDragRef.current;
    if (!gesture) return;
    gesture.pointerX = event.clientX;
    gesture.pointerY = event.clientY;
    if (!gesture.started) {
      if (Math.abs(event.clientY - gesture.y) < DRAG_THRESHOLD_PX
        && Math.abs(event.clientX - gesture.x) < DRAG_THRESHOLD_PX) return;
      const list = overflowListElement();
      if (!list) { rowDragRef.current = null; return; }
      const listRect = list.getBoundingClientRect();
      gesture.listTop = listRect.top;
      gesture.listHeight = listRect.height;
      /* SNAPSHOT ONCE, IN CONTENT SPACE. Measuring per frame would read the
         rows mid-transform and feed the drag its own preview. */
      const rows = [...list.querySelectorAll<HTMLElement>("[data-study-all-tabs-row]")];
      gesture.rows = rows.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-study-tab-id") ?? "",
          groupId: element.closest("[data-study-group-id]")?.getAttribute("data-study-group-id") ?? "",
          top: rect.top - listRect.top + list.scrollTop,
          height: rect.height,
        };
      });
      gesture.sections = [...list.querySelectorAll<HTMLElement>("[data-study-group-id]")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            groupId: element.getAttribute("data-study-group-id") ?? "",
            top: rect.top - listRect.top + list.scrollTop,
            bottom: rect.bottom - listRect.top + list.scrollTop,
          };
        });
      /* THE STEP IS MEASURED WITHIN A STUDY, never across two. This read the
         first two rows in the list, which are only one step apart when the first
         study has at least two of them — otherwise the gap it measured spanned a
         section header and its rules, and the neighbours slid 77px to preview a
         28px move. The slot was right either way, because that comes from
         midpoints; it was only the distance that lied, which is exactly the kind
         of wrong that ships. */
      const step = gesture.rows.reduce<number | null>((found, row, index) => {
        if (found !== null || index === 0) return found;
        const previous = gesture.rows[index - 1];
        return previous && previous.groupId === row.groupId ? row.top - previous.top : null;
      }, null);
      gesture.step = step ?? (gesture.rows[0]?.height ?? 28) + 2;
      gesture.started = true;
      // The transition lives with the gesture: shifts written while this is on
      // slide, and the reset at drop does not — by then the model has already
      // put the rows where the preview said they would be.
      list.setAttribute("data-row-drag-live", "");
      suppressRowClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const carrying = gesture.rows.find((row) => row.id === gesture.tabId);
      if (carrying) {
        setRowCarried({
          id: gesture.tabId,
          /* NOT the first span — that is the tab's mark, and it holds no text,
             so the proxy carried a 40px blank the whole way down the list. The
             label is the row's own span, the one the mark is not. */
          label: [...event.currentTarget.querySelectorAll<HTMLElement>(":scope > span")]
            .find((span) => !span.classList.contains("scripture-workspace-tab-mark"))
            ?.textContent?.trim() ?? "",
          kind: (event.currentTarget.closest("[data-study-all-tabs-row]")
            ?.getAttribute("data-study-tab-kind") ?? "passage") as CarriedTab["kind"],
        });
      }
      rowScrollRafRef.current = window.requestAnimationFrame(stepRowScroll);
    }
    paintRowDrag(gesture);
  }, [overflowListElement, paintRowDrag, stepRowScroll]);

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

  // Before the proxy's first paint, not after: a layout effect runs between the
  // commit and the frame, so the card is never seen anywhere but under the hand.
  useLayoutEffect(() => {
    if (!carried || !carriedRef.current) return;
    carriedRef.current.style.transform = carriedTransform(carriedAtRef.current.x, carriedAtRef.current.y);
  }, [carried]);

  /* THE TAB TRAVELS THE LAST OF THE WAY ITSELF.

     A reorder commits, React re-lays the run out, and the tab is suddenly in its
     new slot. It never crossed the distance — which is the one motion in this
     gesture the reader has actually earned, and the only frame where the app
     knows exactly where they are looking.

     So the difference is played back. `settleRef` holds where the tab was when
     the pointer let go; this runs in the layout phase, after the new positions
     exist and before anything is painted, and puts the tab back where it was
     with the transition off — then clears the offset on the next frame with the
     transition on, so it glides into the slot it is already in.

     It is the same `--tab-drag-x` the drag itself writes, which is deliberate:
     the transform is declared once, in the sheet, and both the gesture and its
     ending contribute a number to it. Two properties would be two chances for
     them to disagree about where the tab is.

     Reduced motion skips the whole thing rather than shortening it — a settle IS
     the motion, and a zero-length one is just the snap it was written against. */
  useLayoutEffect(() => {
    const pending = settleRef.current;
    settleRef.current = null;
    if (!pending || prefersReducedMotionRef.current) return;
    const wrap = tabRefs.current.get(pending.tabId)?.parentElement;
    if (!wrap) return;
    const travelled = pending.left - wrap.getBoundingClientRect().left;
    // Under a pixel is not a journey; playing it back would be a frame of
    // motion nobody asked for on every drop that changed nothing.
    if (Math.abs(travelled) < 1) return;
    wrap.style.setProperty("--tab-drag-x", `${travelled}px`);
    // Reading a layout property between the write and the class is what makes
    // the browser treat them as two states rather than one — without it the
    // start and end are coalesced into the same style recalculation and there is
    // nothing to transition between.
    void wrap.offsetWidth;
    wrap.classList.add("is-settling");
    wrap.style.removeProperty("--tab-drag-x");
    /* AND IT IS TAKEN OFF ON A TIMER AS WELL AS ON THE EVENT. `transitionend`
       does not fire if the browser coalesces the two states into one recalc, or
       if the tab is unmounted mid-glide, and a wrap left wearing this class
       carries a transform transition into every later layout change. The event
       is the fast path; the timer is the one that cannot be skipped. */
    const done = (): void => {
      window.clearTimeout(fallback);
      wrap.classList.remove("is-settling");
      wrap.removeEventListener("transitionend", done);
    };
    const fallback = window.setTimeout(done, 400);
    wrap.addEventListener("transitionend", done);
  }, [registerTabIds]);

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
      () => scheduleControlFocus(groupRenameInputRef.current, overflowPanelFallback),
    );
    if (approved) setRenameGroupId(null);
    if (approved) setRenameDraft("");
    return approved;
  }, [onRenameGroup, renameDraft, runApprovedIntent, overflowPanelFallback, scheduleControlFocus]);

  const handleMoveTab = useCallback(async (
    tabId: string,
    targetGroupId: string,
    focusTarget: HTMLElement,
    slot?: number,
  ): Promise<boolean> => await runApprovedIntent(
    () => onMoveTab(tabId, targetGroupId, slot),
    /* A tab moved between studies REMOUNTS under its new section, so the node
       the caller handed us is disconnected by the time focus is due and the
       fallback would swallow it. Re-resolve by id — the row is still the row,
       it is simply a different element now — and resolve it LAZILY, because
       this callback runs before React has drawn the section it moved to. An
       eager lookup here finds the node that is about to be thrown away.

       Three answers in order, and the order is the point: the row where it
       landed, for a drop inside All Tabs; the control that asked, for the
       strip's own drag onto a study chip, where no such row is on screen; then
       the panel, which is only an answer while the panel is open. */
    () => scheduleControlFocus(null, () => (
      document.querySelector<HTMLElement>(
        `[data-study-all-tabs-row][data-study-tab-id="${CSS.escape(tabId)}"] > button`,
      )
      ?? (focusTarget.isConnected ? focusTarget : null)
      ?? overflowPanelFallback()
    )),
  ), [onMoveTab, runApprovedIntent, overflowPanelFallback, scheduleControlFocus]);

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
    () => scheduleControlFocus(focusTarget, overflowPanelFallback),
  ), [onReorderTab, runApprovedIntent, overflowPanelFallback, scheduleControlFocus]);

  const handleRowPointerUp = useCallback(async (
    event: React.PointerEvent<HTMLButtonElement>,
  ): Promise<void> => {
    const gesture = rowDragRef.current;
    if (!gesture?.started) { rowDragRef.current = null; return; }
    const target = gesture.target;
    const { tabId, groupId } = gesture;
    const source = gesture.rows.filter((row) => row.groupId === groupId);
    const from = source.findIndex((row) => row.id === tabId);
    event.currentTarget.releasePointerCapture(event.pointerId);
    endRowDrag();
    if (!target) return;
    /* ONE COMMIT, EITHER WAY. Same study is a reorder at the slot; a different
       study is a move that carries the slot with it — including through a
       confirmation, so a drop that has to ask a question still lands where the
       reader let go rather than appending and then jumping. */
    if (target.groupId === groupId) {
      // The dragged row is still in the rendered list, so its own position is a
      // no-op that the model would refuse anyway; say so here and save a commit.
      if (target.slot === from) return;
      await handleReorderTab(tabId, { slot: target.slot }, event.currentTarget);
      return;
    }
    await handleMoveTab(tabId, target.groupId, event.currentTarget, target.slot);
  }, [endRowDrag, handleMoveTab, handleReorderTab]);

  const handleReorderGroup = useCallback(async (
    groupId: string,
    position: WorkspaceReorderPosition,
    focusTarget: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onReorderGroup(groupId, position),
    () => scheduleControlFocus(focusTarget, overflowPanelFallback),
  ), [onReorderGroup, runApprovedIntent, overflowPanelFallback, scheduleControlFocus]);


  /* Still here for the STRIP's context menu, which offers "Reopen closed tab"
     to a reader who never opened All Tabs. The head's button that also called
     this is gone: naming the same entry the recovery list names, forty pixels
     above it, was two doors to one act in one small panel. */
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
      /* NOT 0. Zero is a real slot — the first one — and the guard below only
         renders when the slot CHANGES, so a drag whose first computed slot was
         zero would never paint at all. -1 is the honest "not yet asked". */
      insertionIndex: -1,
      studyId: null,
      node: null,
      pointerId: event.pointerId,
      slots: [],
      draggedIndex: -1,
      phase: "reorder",
      band: { top: 0, bottom: 0 },
    };
  };

  /* EVERY EXIT FROM A DRAG COMES THROUGH HERE — the drop, the cancel, and the
     drop that turns into a confirmation the reader then refuses.

     It is one function because the state a drag leaves behind is written in
     three places React cannot see: an offset on the dragged node, a `grabbing`
     cursor on the document, and whatever the sheet is transitioning. A gesture
     that ends down a path nobody wrote a cleanup for leaves a tab stranded
     mid-air under a cursor that will not change back, and this shape of code
     always fails that way — so there is exactly one way out and every path takes
     it. */
  /* IS THE POINTER OVER THE STUDIES — the control, or the list it opens?

     BY RECTANGLE, NOT BY HIT-TEST, and that is forced. The list is a popover,
     and a popover renders a full-viewport scrim beneath its panel: over the
     panel `elementFromPoint` finds a row, but over the CONTROL it finds the
     scrim, which stands above the register at a layer of its own. So the face
     that says "drag here to change study" answered a drag by looking like
     nothing at all, the phase fell back to a reorder, and the list closed under
     the very hand it had invited. The maintainer found it by taking the
     invitation literally.

     Two rectangles is also cheaper than it looks: it runs only when the pointer
     is not already over a study target, and it reads two elements. */
  const overStudySurface = (x: number, y: number): boolean => {
    for (const node of document.querySelectorAll("[data-study-control], .scripture-workspace-context-popover")) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  };

  /* The proxy sits below and right of the cursor, which is where a hand holding
     something leaves it — and, more to the point, NOT over the rows the drop is
     aimed at. One expression, because the mount and every frame after it must
     agree about where the card is or the first one is a jump. */
  const carriedTransform = (x: number, y: number): string =>
    `translate3d(${x + 14}px, ${y + 12}px, 0)`;

  const endDrag = (tabId: string | undefined): void => {
    document.documentElement.removeAttribute("data-tab-drag");
    setCarried(null);
    if (!tabId) return;
    tabRefs.current.get(tabId)?.parentElement?.style.removeProperty("--tab-drag-x");
  };

  /* The proxy's contents, read off the tab it stands for.
     Read from the DOM rather than rebuilt from the model because what the reader
     picked up is what is on screen — the label the strip decided to draw, at the
     length it decided to draw it. A proxy assembled from `workspace` a second
     time is a second chance to disagree with the tab it is standing in for. */
  /* THE PROXY LEAVES THE APP SHELL, so it has to take the theme with it.
     A body portal inherits nothing from `.app-shell`, and every token this card
     is drawn in — paper, ink, the shadows — is declared there. This is the same
     two lines Tooltip and Popover carry, for the same reason and in the same
     shape; a third spelling of it would be a third thing to keep in step. */
  const shell = document.querySelector(".app-shell");
  const materialClasses = shell
    ? [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ")
    : "";

  const carriedTabFor = (tabId: string): CarriedTab | null => {
    const node = tabRefs.current.get(tabId);
    if (!node) return null;
    return {
      id: tabId,
      label: node.querySelector(".scripture-workspace-tab-label")?.textContent ?? "",
      kind: node.dataset.studyTabKind ?? "",
    };
  };

  /* ── WHO OWNS THE GESTURE ONCE IT HAS STARTED ──────────────────────────────

     THE WINDOW DOES, and it has to. This drag used to run entirely on the React
     handlers bound to the tab's own button, with `setPointerCapture` swallowed
     in a try/catch and called "best-effort" — which is fine right up until the
     effort fails. Then every pointermove goes to whatever is under the cursor
     instead of to the captured button, and the difference is invisible while
     the pointer is still over the strip, because the sibling tabs carry the
     same handler and answer in its place. Leave the strip — for the study
     control, which is the one place the drag is INVITED to go — and there is
     nothing under the pointer that listens, so the handler simply stops running
     and the phase freezes on whatever it last was. A reader dragging a tab onto
     a face that says "drag here to change study" watched it do nothing, and the
     tour caught it as an intermittent failure two runs in three.

     So capture is an optimisation now, not a requirement: the gesture is
     followed on the window from the moment it starts, and the listeners come
     off at the drop. `handleTabPointerMove` is still what notices the threshold,
     because until then the pointer is over the tab by definition. */
  const detachTabDragListeners = (): void => {
    const detach = tabDragListenersRef.current;
    tabDragListenersRef.current = null;
    detach?.();
  };

  const handleTabPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
    groupId: string,
  ): void => {
    const origin = dragPointerRef.current;
    if (!origin || origin.groupId !== groupId) return;
    // Once it is running the window owns it, and a second delivery of the same
    // frame would only do the same work twice.
    if (origin.started) return;
    {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
      origin.started = true;
      origin.node = event.currentTarget;
      /* Still asked for, because when it works it is the cheapest way to keep a
         gesture whole; no longer relied upon, because the listeners below hold
         whether or not it does. */
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
      const onMove = (raw: PointerEvent): void => advanceTabDrag(raw.clientX, raw.clientY, groupId);
      const onUp = (): void => { void finishTabDrag(origin.tabId, groupId); };
      const onCancel = (): void => { detachTabDragListeners(); handleTabPointerCancel(); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      tabDragListenersRef.current = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
      /* THE RUN IS MEASURED ONCE, HERE, and every question the drag asks is
         asked of this snapshot. Measuring live would mean measuring the
         consequence of the previous frame — a sibling that has stepped aside is
         no longer where the layout put it — and that is a feedback loop, not a
         measurement. See studyWorkspaceDragShuffle. */
      const entry = groups.find((candidate) => candidate.group.id === groupId);
      origin.slots = (entry?.tabs ?? []).flatMap((tab) => {
        const wrap = tabRefs.current.get(tab.id)?.parentElement;
        if (!wrap) return [];
        const rect = wrap.getBoundingClientRect();
        return [{ id: tab.id, left: rect.left, width: rect.width }];
      });
      origin.draggedIndex = origin.slots.findIndex((slot) => slot.id === origin.tabId);
      const bar = viewportRef.current?.closest(".scripture-workspace-bar");
      if (bar) {
        const rect = bar.getBoundingClientRect();
        origin.band = { top: rect.top - CARRY_SLACK_PX, bottom: rect.bottom + CARRY_SLACK_PX };
      }
      /* AND THE CURSOR IS THE DOCUMENT'S PROBLEM for the length of the gesture.
         `grabbing` on the tab alone is lost the instant the pointer leaves it,
         which on this surface is most of the drag — over the strip's ground,
         over the page, over the study list. It cannot be done with an overlay:
         the drop target is found with `elementFromPoint`, and a layer over the
         document is the one thing that would break it. So the attribute goes on
         the document and the sheet answers it. */
      document.documentElement.setAttribute("data-tab-drag", "");
      // Announced HERE and not at pointerdown: the study control opens its list
      // on this, and a plain click on a tab must not open one. The threshold is
      // already the line this code draws between a press and a drag.
      onTabDragPhase("reorder", origin.tabId);
    }
    advanceTabDrag(event.clientX, event.clientY, groupId);
  };

  const advanceTabDrag = (clientX: number, clientY: number, groupId: string): void => {
    const origin = dragPointerRef.current;
    if (!origin || !origin.started || origin.groupId !== groupId) return;
    /* THE TAB TRAVELS WITH THE POINTER, and it is written straight onto the
       node rather than put in `dragState`.

       A pointer move fires on every frame of a drag; a state update per frame
       re-renders every tab in the strip to move ONE of them, and at 676 rows in
       a long study that is the difference between a drag that glides and a drag
       that stutters. The same argument the viewport-resize handler in app.tsx
       makes when it pins --player-column-w imperatively, for the same reason.

       It is a custom property rather than `transform` directly so the sheet
       still owns the whole transform — the lift, the settle when the pointer
       reaches a study, and the reduced-motion answer are all one declaration in
       one place, and this line contributes a number to it and nothing else. */
    const dragged = tabRefs.current.get(origin.tabId)?.parentElement;
    if (dragged) dragged.style.setProperty("--tab-drag-x", `${clientX - origin.x}px`);
    // A drag that reaches a study target is asking for a study rather than a
    // slot. It outranks the insertion index because the two answers cannot both
    // be shown without the row claiming to do both.
    const studyId = studyDropTargetId(
      document.elementFromPoint(clientX, clientY),
      groupId,
    );
    const settledStudyId = origin.studyId;
    if (studyId !== settledStudyId) onTabDragOverStudy(studyId);
    origin.studyId = studyId;

    /* IN THE ROW, OR CARRIED OFF IT — and the test is the row, not the strip.
       A pointer over a study target is carrying by definition; so is one that
       has left the register's own band, which is what a reader does on the way
       to the list. The band is snapshotted with everything else, because the bar
       moves under a drag exactly never and asking it every frame would be a
       layout read per frame for an answer that cannot change. */
    const phase: "reorder" | "carry" = studyId !== null
      || clientY < origin.band.top
      || clientY > origin.band.bottom
      || overStudySurface(clientX, clientY)
      ? "carry"
      : "reorder";
    const settledPhase = origin.phase;
    origin.phase = phase;
    if (phase !== settledPhase) {
      onTabDragPhase(phase, origin.tabId);
      /* The proxy is built from the tab's own label and kind so it is the same
         object the reader picked up, not a generic card. Cleared rather than
         left standing when the pointer comes home: a tab cannot be both in the
         row and in the hand. */
      setCarried(phase === "carry" ? carriedTabFor(origin.tabId) : null);
    }
    /* Per-frame, and imperative for the reason everything per-frame here is:
       one node moves, and a state update would re-render the register to do it.
       The offset puts the card below and right of the cursor, which is where a
       hand holding something leaves it — over it would hide the very rows the
       drop is aimed at. */
    carriedAtRef.current = { x: clientX, y: clientY };
    if (phase === "carry" && carriedRef.current) {
      carriedRef.current.style.transform = carriedTransform(clientX, clientY);
    }
    /* THE SLOT, FROM THE SNAPSHOT. The dragged tab's centre is where it started
       plus how far the pointer has travelled — never its live rect, which is the
       thing being moved. */
    const held = origin.slots[origin.draggedIndex];
    if (!held) return;
    const { insertionIndex, shifts } = studyWorkspaceDragShuffle(
      origin.slots,
      origin.draggedIndex,
      held.left + (clientX - origin.x) + held.width / 2,
    );
    /* AND STATE IS SET ONLY WHEN SOMETHING DISCRETE CHANGED.
       This used to build a fresh object every pointermove, so every frame of
       every drag re-rendered the whole strip — six hundred and seventy-six rows
       in a long study, to move one tab — which is the cost the `--tab-drag-x`
       write above exists to avoid, paid anyway one line later. The tab's own
       travel stays imperative and touches one node; the siblings' positions are
       a fact about which SLOT the pointer is in, and that changes a handful of
       times in a whole gesture. Render for the discrete thing, write for the
       continuous one. */
    const settledIndex = origin.insertionIndex;
    origin.insertionIndex = insertionIndex;
    if (phase === settledPhase
      && studyId === settledStudyId
      && insertionIndex === settledIndex) return;
    setDragState({ tabId: origin.tabId, groupId, insertionIndex, studyId, shifts, phase });
  };

  /* The drop takes no coordinates. Everything it commits — the study under the
     pointer, the slot the run opened — was decided by the last move and is
     already on `origin`; re-deriving it from the release point would let one
     stray final pixel disagree with the preview the reader was just shown. */
  const finishTabDrag = async (
    tabId: string,
    groupId: string,
  ): Promise<void> => {
    // First, so a pointerup delivered twice — once by the window, once by the
    // element that still has capture — cannot commit the same drop twice.
    detachTabDragListeners();
    const origin = dragPointerRef.current;
    dragPointerRef.current = null;
    /* WHERE THE READER LAST SAW IT, recorded before anything is torn down.
       A drop commits a reorder and React re-lays the run out; without this the
       tab would vanish from under the pointer and reappear in its new slot, and
       the one moment in the gesture when the app knows exactly where the eye is
       says nothing. The settle effect below plays the difference back. */
    if (origin?.started && !origin.studyId) {
      const wrap = tabRefs.current.get(origin.tabId)?.parentElement;
      if (wrap) settleRef.current = { tabId: origin.tabId, left: wrap.getBoundingClientRect().left };
    }
    setDragState(null);
    // The tab goes home before anything else happens. It is written on the node,
    // so nothing in a re-render clears it and a dropped tab left carrying a
    // 300px offset would simply stay there.
    endDrag(origin?.tabId);
    if (origin?.studyId) onTabDragOverStudy(null);
    // The list may close now: which study was under the pointer is already read
    // off `origin`, so the move below does not depend on the rows still being
    // there. Announcing the end before awaiting the move is what keeps the list
    // from hanging open across a confirmation.
    if (origin?.started) onTabDragPhase(null, null);
    if (!origin || !origin.started) return;
    suppressTabClickRef.current = true;
    try { origin.node?.releasePointerCapture(origin.pointerId); } catch { /* release is best-effort */ }
    /* A DROP ON A STUDY IS THE MOVE THE MENUS ALREADY MAKE — same mutation, same
       confirmations, same refusals. The gesture is a second door onto
       `onMoveTab`, never a second set of rules for changing a tab's study.

       And a drop on the row that has no study yet is the PROMOTE the tab menu
       already makes, which is the same claim a second time: `handlePromoteTab`
       refuses what it refuses, and the row only offers itself when that
       mutation would go through. Neither branch invents an outcome. */
    if (origin.studyId === START_STUDY_TARGET) {
      await handlePromoteTab(tabId);
      return;
    }
    if (origin.studyId) {
      await handleMoveTab(tabId, origin.studyId, origin.node ?? document.body);
      return;
    }
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const orderedIds = entry.tabs.map((tab) => tab.id);
    const position = studyWorkspaceDragReorderPosition(orderedIds, tabId, origin.insertionIndex);
    if (position) await handleReorderTab(tabId, position, origin.node ?? document.body);
  };

  const handleTabPointerCancel = (): void => {
    endDrag(dragPointerRef.current?.tabId);
    if (dragPointerRef.current?.studyId) onTabDragOverStudy(null);
    // A cancelled drag ends the drag. The list would otherwise be left open by a
    // gesture the platform tore up — the one path where nothing else runs.
    if (dragPointerRef.current?.started) onTabDragPhase(null, null);
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
        /* THE SHUFFLE'S TRANSITION LIVES ON THIS ATTRIBUTE and therefore only
           exists while a drag does. A wrap carries a 150ms entrance animation on
           mount, and a transform transition declared at rest would run against
           it every time a tab is opened — two motions on one property, which is
           a fight neither wins. Scoped here, the transition is switched on at
           the threshold and off at the drop, and reduced motion still reaches it
           through the wrap rule it already kills. */
        data-drag-live={dragState ? "" : undefined}
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
        return tabs.map((tab) => {
          const label = studyWorkspaceTabLabel(workspace, tab, bookNames);
          const labelParts = studyWorkspaceTabLabelParts(workspace, tab, bookNames);
          const selected = workspace.activeTabId === tab.id;
          const roving = effectiveRovingTabId === tab.id;
          const closeAvailability = studyWorkspaceTabCloseAvailability(workspace, tab.id);
          const canClose = closeAvailability !== "unavailable";
          const closeCopy = studyWorkspaceCloseActionCopy(label, closeAvailability);
          const dragging = dragState?.tabId === tab.id;
          // A drag over a study has left the row's question behind, so the run
          // stops answering it: the tabs close back up and the only thing saying
          // where this lands is the surface the pointer is actually over.
          const overStudy = dragState?.studyId != null;
          /* THE TAB LEAVES THE ROW WHEN IT IS CARRIED OFF IT, and the run closes
             the gap behind it. It is hidden rather than unmounted: the move may
             still be refused, or need a confirmation, and a tab that had really
             left would have to be put back — from a component that no longer has
             it. `visibility` keeps the node, its ref and its geometry, so the
             snap-back is the class coming off. */
          const carriedOff = dragging && dragState?.phase === "carry";
          /* HOW FAR THIS TAB HAS STEPPED ASIDE. Zero for every tab until the
             dragged one passes its middle, and then the distance to the slot it
             is giving up — a positional delta from the drag's own snapshot, not
             a tab width, because the run's gaps are uneven wherever the selected
             tab's fillet margins fall. See studyWorkspaceDragShuffle. */
          const shift = dragState?.phase === "carry" ? 0 : dragState?.shifts.get(tab.id) ?? 0;
          return (
            <div
              className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`}
              role="presentation"
              key={tab.id}
              data-study-group-id={group.id}
              style={shift ? { "--tab-shift": `${shift}px` } as React.CSSProperties : undefined}
              /* THE TAB SETTLES ONCE IT HAS SOMEWHERE TO GO. Lifted, it is a
                 card held above the strip; over a study it eases down and back
                 a little, because the affirmation has moved to the destination
                 and two things claiming the eye at the moment of a drop is one
                 thing too many. It is the handoff, drawn. */
              data-drag-away={(dragging && overStudy) || undefined}
              data-carried={carriedOff || undefined}
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
                /* No `onPointerUp` here any more: a press that never became a
                   drag has nothing to finish, and one that did is followed on
                   the window, which hears the release wherever it happens —
                   including over a surface this component does not own. */
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

      {/* THE STUDY, AT THE HEAD OF THE RIGHT-HAND RUN · 2026-08-03. Rev 05 §05·2
          ruled that a study's label "belongs in the strip", and it does; it was
          only ever its ALTERNATIVE placement — at the head of the members — that
          could not be built, twice, because a name given a fixed width beside
          the first tab clipped and shouldered the flush-start corner. At this
          end there is no fixed width to give it.

          It comes BEFORE the cluster because that cluster reports on tabs and
          this names what the tabs belong to; the reader reads outward from the
          page. And the auto end-margin moves onto it in the sheet rather than
          being added here — two auto margins in one row are not twice one auto
          margin, they split the free space and fling the pair to opposite ends. */}
      {studies}

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
        {/* THE GATE USED TO READ `allGroups.length > 0 || hasMeasuredOverflow`,
            which is the same sentence twice: the model refuses to close the last
            study, so there is always at least one group and the left side is
            always true. The right side was the overflow story — show the door
            when the strip cannot show everything — and it has been dead code
            since the door stopped being about overflow. What it measures is
            still worth publishing: `data-study-overflowing` stays, because the
            sheet fades the run's edges by it. */}
        {allGroups.length > 0 && (
          <Tooltip label="All tabs — switch, reopen">
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
                setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
                setOverflowOpen(true);
              }}
              /* NAMED FOR WHAT IT DOES NOW. "Show all N study tabs in M studies"
                 described an overflow list, and every job that made it one has
                 since moved out: reaching another study went to the study line,
                 tabs past the edge of the row went to wheel-pan and the edge
                 fades, and jumping by ordinal went to ⌘1–9. What is left is
                 management — switch to a tab in any study, recover something
                 closed, rename or order or close a study you are not in — so
                 the name leads with those verbs and keeps the count after them,
                 which is where a count belongs on a control that opens a list.
                 "search" left the name on 2026-08-03 with the field it named:
                 typing still finds a row, but it moves to it rather than hiding
                 the others, and that is a menu's behaviour, not a search's. */
              aria-label={
                `All tabs — switch, reopen; ${totalTabs} open in `
                + `${allGroups.length} ${allGroups.length === 1 ? "study" : "studies"}`
              }
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
              // Only while the panel exists: an aria-controls pointing at an id
              // that is not in the document names nothing.
              aria-controls={overflowOpen ? OVERFLOW_PANEL_ID : undefined}
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
          id={OVERFLOW_PANEL_ID}
          anchorRect={overflowAnchor}
          onClose={dismissOverflow}
          width={440}
          maxHeight={560}
          className="scripture-workspace-overflow-popover"
          ariaLabel="All study tabs"
          /* THE CARET LANDS ON THE TAB YOU ARE READING. It used to land in the
             search field, which was the only text in the panel and so the only
             sane answer while there was one. With the field gone, Popover's own
             fallback would take the first focusable descendant — the head's
             button, or a header tool sitting at opacity 0 — so the panel says
             where instead. The active row is where a reader's attention already
             is, and it makes every arrow key relative to the thing they are
             looking at rather than to the top of a list. */
          initialFocusRef={activeOverflowRowRef}
        >
          {/* ONE LINE, AND ONE DOOR TO RECOVERY. A "Reopen Genesis 2" button
              stood at the right of this head, naming the same entry the
              Recently-closed section names forty pixels below it — two doors to
              one act in a panel four hundred and forty pixels wide, and the one
              up here had to restate the entry's name to say what it did. The
              section keeps it, with ⌘⇧T beside its heading, and the head goes
              back to being what a head is: the title, and how much is behind
              it, on one line. */}
          <div className="scripture-workspace-overflow-head">
            <strong>All Tabs</strong>
            <span>{totalTabs} open in {allGroups.length} {allGroups.length === 1 ? "study" : "studies"}</span>
          </div>
          <div className="scripture-workspace-overflow-list">
            {allGroups.map(({ group, label, tabs }) => {
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
                      /* The name and its count, and nothing else. Rename used
                         to stand between them, so the count could never reach
                         the panel's right rail — it stopped against a verb. */
                      <div className="scripture-workspace-group-title">
                        <strong>{label}</strong><span>{tabs.length}</span>
                      </div>
                    )}
                    {/* All three verbs in one place, in one treatment. Rename sat
                        in the title as bare text while Order and Close sat out
                        here; three tools in a row answering to two rules reads as
                        an accident, because it was one. */}
                    <div className="scripture-workspace-group-tools">
                      {!renaming && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenameGroupId(group.id);
                            setRenameDraft(label);
                            window.setTimeout(() => groupRenameInputRef.current?.focus({ preventScroll: true }), 0);
                          }}
                        >Rename</button>
                      )}
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
                      /* ⌘1–9 COUNTS THE STRIP, WHICH IS THE STUDY YOU ARE IN —
                         not the register. The note here used to say the whole
                         register including collapsed studies, and that was true
                         of a workspace where every study's tabs shared one run.
                         `studyWorkspaceStripTabIds` has counted the active
                         group alone since the register learned to hold one
                         study at a time, so `studyWorkspaceTabOrdinal` returns
                         null for every tab in every other study and the hint
                         below renders in exactly one section of this list. That
                         is the honest thing to draw: a ⌘4 beside a tab in a
                         study you are not in would address a different tab.

                         The numbers live here and never on the tabs themselves —
                         a strip of shortcut hints is chrome about chrome. */
                      const ordinal = studyWorkspaceTabOrdinal(workspace, tab.id);
                      return (
                        <div
                          className="scripture-workspace-overflow-row"
                          data-study-all-tabs-row=""
                          data-study-tab-id={tab.id}
                          data-study-tab-kind={tab.kind}
                          // The row being carried keeps its space in the list —
                          // the gap the others open is the preview, and a row
                          // that also collapsed would double it.
                          data-row-carried={rowDrag?.tabId === tab.id ? "" : undefined}
                          key={tab.id}
                        >
                          <button
                            type="button"
                            ref={workspace.activeTabId === tab.id ? activeOverflowRowRef : undefined}
                            className={workspace.activeTabId === tab.id ? "is-active" : undefined}
                            /* THE WHOLE ROW DRAGS. No grip glyph: a handle would
                               be one more mark on every row to buy a gesture the
                               row can carry itself, and the four-pixel threshold
                               is what keeps a press from becoming a drag. */
                            onPointerDown={(event) => handleRowPointerDown(event, tab.id, group.id)}
                            onPointerMove={handleRowPointerMove}
                            onPointerUp={handleRowPointerUp}
                            onPointerCancel={endRowDrag}
                            /* THE ROW'S VERBS ARE ON ITS MENU, not beside it.
                               Order and Move stood here as two more buttons per
                               row, which made a twenty-tab list eighty tab stops
                               and made every row a small toolbar. They are the
                               same verbs the strip's own tabs offer on a
                               right-click, so the row offers them the same way —
                               one builder, one set of items, and the Menu key
                               reaches it from the keyboard because the platform
                               fires `contextmenu` on the focused element. */
                            onContextMenu={(event) => openContextMenu(
                              { kind: "tab", tabId: tab.id, groupId: group.id },
                              event,
                              { keepOverflow: true },
                            )}
                            onClick={async () => {
                              // A drag ends with a click the browser owes us and
                              // the reader did not ask for.
                              if (suppressRowClickRef.current) {
                                suppressRowClickRef.current = false;
                                return;
                              }
                              await handleSelectTab(tab.id, { closeOverflow: true, moveFocus: true });
                            }}
                            /* `Current` was a FOURTH signal on one row — a seal
                               edge-bar, a tint, the word, and the ordinal. The
                               bar and the tint are the register's own vocabulary
                               for "this one" and are stated everywhere else
                               without help; `aria-current` says the same thing
                               to a screen reader, which is the only reader the
                               word was still working for. */
                            aria-current={workspace.activeTabId === tab.id ? "true" : undefined}
                          >
                            <TabMark tab={tab} /><span>{tabLabel}</span>
                            {ordinal !== null && (
                              <kbd
                                className="scripture-workspace-overflow-shortcut"
                                data-study-tab-ordinal={ordinal}
                              >{`⌘${ordinal}`}</kbd>
                            )}
                          </button>
                          <div className="scripture-workspace-row-tools">
                            {canClose && (
                              <button
                                type="button"
                                data-study-close-availability={tabCloseAvailability}
                                aria-label={tabCloseCopy.ariaLabel}
                                title={tabCloseCopy.title}
                                onMouseDown={deferMouseFocus}
                                /* CLOSING A TAB KEEPS THE LIST OPEN. It used to
                                   dismiss the whole overview, so tidying three
                                   tabs was three trips out to the ⋯ and back —
                                   a list you can only act on once is not a list.
                                   Selecting still closes, because that one takes
                                   the reader somewhere. */
                                onClick={async (event) => {
                                  /* Focus goes to the NEIGHBOUR, which is what
                                     a reader closing several in a row wants and
                                     what the field used to stand in for: the
                                     stop that slides up into this one's place,
                                     or the one above when this was the last. */
                                  const before = overflowStops();
                                  const at = before.indexOf(
                                    event.currentTarget.closest("[data-study-all-tabs-row]")
                                      ?.querySelector("button") as HTMLButtonElement,
                                  );
                                  await handleCloseTab(tab.id, { moveFocus: false });
                                  window.setTimeout(() => {
                                    const after = overflowStops();
                                    if (after.length === 0) return;
                                    const next = at < 0 ? 0 : Math.min(at, after.length - 1);
                                    after[next]?.focus({ preventScroll: true });
                                  }, 0);
                                }}
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
          </div>
          {recentlyClosedList.length > 0 && (
            <div className="scripture-workspace-recent-list" data-study-recent-list="">
              <div className="scripture-workspace-recent-head">
                <span className="scripture-workspace-recent-heading">Recently closed</span>
                {/* THE SHORTCUT EXISTS AND WAS ADVERTISED NOWHERE. ⌘⇧T has
                    reopened the most recent item all along; the only place a
                    reader could have learned it is the source. It sits with the
                    list it acts on, in the same `kbd` the rows use for ⌘n. */}
                <kbd className="scripture-workspace-overflow-shortcut">⌘⇧T</kbd>
                <button
                  type="button"
                  data-study-recent-clear=""
                  onMouseDown={deferMouseFocus}
                  /* A NET NOBODY CAN EMPTY fills up with things the reader has
                     stopped meaning to recover — ten deep, surviving restarts,
                     removable only by reopening them, which is the opposite of
                     what someone tidying wants. The undo is not a nicety here:
                     this IS the recovery list, so it is cleared for real on the
                     press and offered back for as long as the toast stands. */
                  onClick={onClearRecent}
                >Clear</button>
              </div>
              {recentlyClosedList.map(({ item, index }) => (
                <button
                  type="button"
                  key={`${item.kind}-${index}`}
                  data-study-recent-item=""
                  onMouseDown={deferMouseFocus}
                  // Same walk as the rows above: to a reader looking for a
                  // chapter these are one list, and the arrows do not stop at
                  // the seam between what is open and what is recoverable.
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

      {/* THE CARRIED TAB, over everything and touchable by nothing.

          It portals to the body for two reasons that both have to hold: the
          strip's viewport clips on x and carries a mask, so a proxy inside it
          would be cut off at the first edge it crossed; and it has to be ABOVE
          the study list it is being dragged over, which is itself a fixed layer
          outside this subtree.

          `pointer-events: none` is not politeness. The drop target is found with
          `elementFromPoint` at the cursor, and the cursor is exactly where this
          card is — a proxy that could be hit would be the only thing the drag
          ever found, and every drop would land on nothing. */}
      {carried && createPortal(
        <div
          ref={carriedRef}
          className={`scripture-workspace-tab-ghost ${materialClasses}`}
          data-study-tab-ghost=""
          data-study-tab-kind={carried.kind}
          aria-hidden="true"
        >
          <TabMarkForKind kind={carried.kind} />
          <span className="scripture-workspace-tab-label">{carried.label}</span>
        </div>,
        document.body,
      )}

      {/* The row's ghost. Portalled to the body for the same reason the strip's
          is — a fixed layer cannot be clipped by the panel it started in — and
          `pointer-events: none` for the same reason too: the drop is decided by
          arithmetic here rather than by hit-testing, but a proxy under the
          cursor would still swallow the pointerup that ends the gesture. */}
      {rowCarried && createPortal(
        <div
          ref={rowGhostRef}
          className={`scripture-workspace-row-ghost ${materialClasses}`}
          data-study-row-ghost=""
          data-study-tab-kind={rowCarried.kind}
          aria-hidden="true"
        >
          <TabMarkForKind kind={rowCarried.kind} />
          <span>{rowCarried.label}</span>
        </div>,
        document.body,
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
                          // Named, so the tours can say which study they mean
                          // without matching on a label a reader can rename.
                          data-study-move-group={entry.group.id}
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
