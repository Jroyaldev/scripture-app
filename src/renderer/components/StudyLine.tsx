import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookNameData } from "../api.js";
import {
  STUDY_WORKSPACE_GROUP_LIMIT,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceGroupLabel,
  type StudyWorkspaceGroup,
  type StudyWorkspaceStateV2,
} from "../utils/studyWorkspace.js";
import { Popover } from "./Popover.js";
import { Tooltip } from "./Tooltip.js";

/**
 * THE STUDY LINE — the frame's top row, and the only place a study is named.
 *
 * It stands in the band the window is dragged by, above the tab strip: one chip
 * per study and the control that starts one. Pressing a chip lands on the tab
 * that study was last on, and the strip underneath becomes that study's tabs —
 * because the strip always holds the study the page is in.
 *
 * Three rules govern everything here.
 *
 * SELECTION LEADS, THE LINE FOLLOWS, and there is nothing else it could do.
 * The line holds no state at all: which chip is current is read off
 * `workspace.activeTabId`. Ctrl+Tab, ⌘1–9, reopening a closed tab and opening a
 * connection into another study all move the active tab, and the line moves
 * with them for free. It cannot block a selection because it never takes part
 * in one — the only thing a chip ever asks the model for is a tab — and a
 * refused selection leaves the line exactly where the page still is.
 *
 * THE LINE RESTS UNTIL THERE IS SOMETHING TO CHOOSE. The model guarantees at
 * least one study, and one study is not a choice. At the floor the band keeps
 * its full height and its drag region and goes quiet: the study's name in
 * resting ink and the small +. Chips become chips when a second study is born —
 * the line wakes up rather than re-laying out, because the band, the name's
 * position and the + do not move.
 *
 * NOTHING BUT THE STRIP'S CONTENT CHANGES WHEN YOU SWITCH. The current study is
 * told by ink and weight over a width the label reserves in every state, so a
 * switch repaints the strip beneath and moves nothing above it.
 */

/** Warn on the `+` once within this many studies of the hard cap. */
const STUDY_CAPACITY_HINT_THRESHOLD = 2;

const START_STOP = "start-study";
/** Chip stops are namespaced so a group id can never collide with a fixed one. */
const studyStop = (groupId: string): string => `study:${groupId}`;

export interface StudyLineChip {
  groupId: string;
  label: string;
  tabCount: number;
  current: boolean;
  /** The reader gave this study a name, which is the act the seal certifies. */
  named: boolean;
}

function PlusGlyph(): React.JSX.Element {
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>;
}

/**
 * Does the line rest, or does it draw chips?
 *
 * The model guarantees at least one group — `closeStudyWorkspaceGroup` refuses
 * the last one and the validator rejects a workspace with none — so one study
 * is the floor and not an edge case. At the floor there is nothing to choose
 * between, and a row of one chip is a menu with one item in it: it advertises a
 * decision the reader does not have. So the line rests — the study's name in
 * resting ink, and the + — and the chips arrive with the second study.
 */
export function studyLineRestsMinimal(groupCount: number): boolean {
  return groupCount <= 1;
}

/**
 * The study the line is standing on: the one the page is in.
 *
 * There is no filter and no state. Which study the strip shows and which chip
 * is current are the same fact as which tab is active, which is why the line
 * cannot get out of step with the page.
 */
export function studyLineActiveStudyId(
  workspace: StudyWorkspaceStateV2,
): string | null {
  return workspace.tabsById[workspace.activeTabId]?.groupId ?? null;
}

/**
 * The tab a chip lands on: the one that study was last on.
 *
 * `lastActiveTabId` is maintained by `selectStudyWorkspaceTab` on every
 * selection and is exactly this fact, so it is read rather than reconstructed.
 * The two fallbacks are for a group whose record has been trimmed by a close:
 * the home passage every group is guaranteed to own, then the first surviving
 * member. Membership is double-booked — `tab.groupId` and `group.tabIds` — and
 * a tab whose two records disagree is inert everywhere else in the model, so it
 * is inert here too.
 */
export function studyLineLandingTabId(
  workspace: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
): string | null {
  const owns = (tabId: string): boolean => workspace.tabsById[tabId]?.groupId === group.id;
  if (owns(group.lastActiveTabId)) return group.lastActiveTabId;
  if (owns(group.homePassageTabId)) return group.homePassageTabId;
  return group.tabIds.find(owns) ?? null;
}

/** The chips, in the model's own group order. */
export function studyLineChips(
  workspace: StudyWorkspaceStateV2,
  bookNames: BookNameData,
): StudyLineChip[] {
  const currentId = studyLineActiveStudyId(workspace);
  return workspace.groups.map((group) => ({
    groupId: group.id,
    label: studyWorkspaceGroupLabel(workspace, group, bookNames),
    tabCount: group.tabIds.filter((tabId) => workspace.tabsById[tabId]?.groupId === group.id).length,
    current: group.id === currentId,
    named: group.label.kind === "custom",
  }));
}

export interface StudyLineProps {
  workspace: StudyWorkspaceStateV2;
  bookNames: BookNameData;
  onSelectTab: (tabId: string) => Promise<boolean>;
  onRenameStudy: (groupId: string, label: string) => Promise<boolean>;
  onCloseStudy: (groupId: string) => Promise<boolean>;
  onStartStudy: () => Promise<boolean>;
  onNewTab: () => void;
  /** A study that has just been made and is waiting to be named. */
  namingRequest: { groupId: string; nonce: number } | null;
  /**
   * The study a tab is currently being dragged over, reported by the strip.
   *
   * It arrives as a prop rather than as state here for the reason the whole
   * line holds none: the gesture belongs to the strip, which owns the pointer
   * and the tab. The line paints what the pointer is over and knows nothing
   * else about the drag — least of all how to commit it.
   */
  dropTargetStudyId: string | null;
}

export function StudyLine({
  workspace,
  bookNames,
  onSelectTab,
  onRenameStudy,
  onCloseStudy,
  onStartStudy,
  onNewTab,
  namingRequest,
  dropTargetStudyId,
}: StudyLineProps): React.JSX.Element {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [focusIntent, setFocusIntent] = useState<{ key: string; nonce: number } | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [chipMenu, setChipMenu] = useState<{ groupId: string; anchor: DOMRect } | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<Map<string, HTMLElement>>(new Map());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameGroupIdRef = useRef<string | null>(null);
  const namingNonceRef = useRef<number | null>(null);
  const focusNonceRef = useRef(0);
  const pendingIntentRef = useRef(false);

  const restsMinimal = studyLineRestsMinimal(workspace.groups.length);
  const chips = useMemo(() => studyLineChips(workspace, bookNames), [bookNames, workspace]);
  const currentStudyId = studyLineActiveStudyId(workspace);

  // Roving tabindex: one stop for the whole line, and the arrows travel it.
  //
  // The line is deliberately NOT a tablist. The strip below it is one, and a
  // tablist standing above another tablist that controls the same panel reads
  // to a screen reader as two sets of tabs for one page. A toolbar is APG's
  // pattern for a row of related controls sharing one tab stop, which is what
  // this is; the current study is `aria-current` rather than `aria-selected`
  // for the same reason — there is one selection in this frame and it is the
  // tab, not the study.
  const stops = useMemo(() => [
    ...chips.map((chip) => studyStop(chip.groupId)),
    START_STOP,
  ], [chips]);
  const currentStop = currentStudyId === null ? START_STOP : studyStop(currentStudyId);
  const rovingKey = focusedKey && stops.includes(focusedKey)
    ? focusedKey
    : (stops.includes(currentStop) ? currentStop : stops[0]);

  useLayoutEffect(() => {
    const chipsRow = chipsRef.current;
    if (!chipsRow) return;
    const measure = (): void => {
      setScrollEdges({
        left: chipsRow.scrollLeft > 2,
        right: chipsRow.scrollLeft + chipsRow.clientWidth < chipsRow.scrollWidth - 2,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chipsRow);
    chipsRow.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      chipsRow.removeEventListener("scroll", measure);
    };
  }, [chips.length]);

  // A chip beyond the row's fade is still the current study, so it is brought
  // into view when the line follows a selection it did not make.
  useEffect(() => {
    stopRefs.current.get(currentStop)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentStop]);

  const endRename = useCallback((): void => {
    renameGroupIdRef.current = null;
    setRenameGroupId(null);
  }, []);

  /**
   * Move the roving stop, and put focus on it once it exists.
   *
   * Deliberately NOT `requestAnimationFrame`. The register's own strip focuses
   * in a frame, and that is fine there, but a frame is a compositor promise: an
   * Electron window that is occluded throttles rAF to never, so the roving
   * tabindex moves and focus does not — the two go out of step and the arrows
   * stop working with no error anywhere. A layout effect is the same "after the
   * DOM has caught up" guarantee without asking the compositor for anything.
   *
   * The nonce is what makes a second press of the same key a second request; a
   * bare key would look unchanged and the effect would not re-run.
   */
  const focusStop = useCallback((key: string): void => {
    focusNonceRef.current += 1;
    setFocusedKey(key);
    setFocusIntent({ key, nonce: focusNonceRef.current });
  }, []);

  useLayoutEffect(() => {
    if (!focusIntent) return;
    stopRefs.current.get(focusIntent.key)?.focus({ preventScroll: false });
    setFocusIntent(null);
  }, [focusIntent]);

  const beginRename = useCallback((groupId: string, label: string): void => {
    renameGroupIdRef.current = groupId;
    setRenameGroupId(groupId);
    setRenameDraft(label);
  }, []);

  // The field opens with the old name selected, so the first keystroke replaces
  // it — a study is usually being named rather than edited. `autoFocus` puts
  // focus in it; this is what puts the caret around the whole of it.
  useLayoutEffect(() => {
    if (!renameGroupId) return;
    renameInputRef.current?.select();
  }, [renameGroupId]);

  // A study is born unnamed and the reader is invited to name it at once. The
  // invitation used to be a synthetic click on the strip's Manage control,
  // which opened a dialog over the page to ask for four words; it is the chip's
  // own field now, so the request is a nonce rather than a DOM handshake.
  useEffect(() => {
    if (!namingRequest) return;
    if (namingNonceRef.current === namingRequest.nonce) return;
    namingNonceRef.current = namingRequest.nonce;
    const group = workspace.groups.find((candidate) => candidate.id === namingRequest.groupId);
    if (!group) return;
    setFocusedKey(studyStop(group.id));
    beginRename(group.id, studyWorkspaceGroupLabel(workspace, group, bookNames));
  }, [beginRename, bookNames, namingRequest, workspace]);

  // A study that closes while its chip is being renamed takes the field with
  // it — and its menu too, which is the same rule applied to the same fact: no
  // surface may go on standing for a study that is not there.
  useEffect(() => {
    if (!renameGroupId) return;
    if (workspace.groups.some((group) => group.id === renameGroupId)) return;
    endRename();
  }, [endRename, renameGroupId, workspace.groups]);

  useEffect(() => {
    if (!chipMenu) return;
    if (workspace.groups.some((group) => group.id === chipMenu.groupId)) return;
    setChipMenu(null);
  }, [chipMenu, workspace.groups]);

  /**
   * Open a study.
   *
   * A chip asks for ONE thing: the tab that study was last on. It does not
   * touch a filter, because there is no filter — the strip shows the study the
   * page is in, so the row underneath follows the selection the same way the
   * page does. A refused selection therefore changes nothing anywhere, which is
   * the only honest outcome for a refusal.
   *
   * It reports whether the page arrived, 2026-07-30, and that is all the return
   * value is for: the chip's own press ignores it, because a refusal leaves the
   * line where the page still is either way. "New tab in this study" is the
   * caller that needs it — a tab opens into the study the page is in, so a
   * refused landing must not be followed by opening one somewhere else.
   */
  const openStudy = useCallback(async (groupId: string): Promise<boolean> => {
    if (pendingIntentRef.current) return false;
    const group = workspace.groups.find((candidate) => candidate.id === groupId);
    if (!group) return false;
    pendingIntentRef.current = true;
    try {
      const landing = studyLineLandingTabId(workspace, group);
      if (landing && landing !== workspace.activeTabId) return await onSelectTab(landing);
      return landing !== null;
    } finally {
      pendingIntentRef.current = false;
    }
  }, [onSelectTab, workspace]);

  const dismissChipMenu = useCallback((groupId: string): void => {
    setChipMenu(null);
    focusStop(studyStop(groupId));
  }, [focusStop]);

  const commitRename = useCallback(async (groupId: string, refocus: boolean): Promise<void> => {
    // Escape unmounts the field, and an unmounting input can still blur; the ref
    // is what tells a real submit from that echo.
    if (renameGroupIdRef.current !== groupId) return;
    const trimmed = renameDraft.trim();
    endRename();
    if (trimmed) await onRenameStudy(groupId, trimmed);
    // Enter leaves focus nowhere when the field unmounts, so the chip takes it
    // back. A blur means the reader has already pressed the thing they want
    // focused — pulling focus back to the chip they just left would fight it.
    if (refocus) focusStop(studyStop(groupId));
  }, [endRename, focusStop, onRenameStudy, renameDraft]);

  const handleLineKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // While a chip is a field, the arrows belong to the caret.
    if (renameGroupId) return;
    const current = Math.max(0, stops.indexOf(rovingKey ?? ""));
    let index: number | null = null;
    if (event.key === "ArrowRight") index = (current + 1) % stops.length;
    else if (event.key === "ArrowLeft") index = (current - 1 + stops.length) % stops.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = stops.length - 1;
    if (index == null) return;
    const next = stops[index];
    if (!next) return;
    event.preventDefault();
    focusStop(next);
  };

  const studyCount = workspace.groups.length;
  const atStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT;
  const nearStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT - STUDY_CAPACITY_HINT_THRESHOLD;
  // The cap this control meets is STUDY_WORKSPACE_GROUP_LIMIT, and the copy says
  // studies — the same shape the tab plus uses for its own 64, in its own unit.
  // A limit stated in the wrong unit is worse than an unstated one.
  const startTooltip = atStudyCapacity
    ? `All ${STUDY_WORKSPACE_GROUP_LIMIT} studies open — close one to start another`
    : nearStudyCapacity
      ? `${studyCount} of ${STUDY_WORKSPACE_GROUP_LIMIT} studies open`
      : "Start a new study";

  const registerStop = (key: string) => (node: HTMLElement | null): void => {
    if (node) stopRefs.current.set(key, node);
    else stopRefs.current.delete(key);
  };

  return (
    <div
      className="scripture-study-line"
      data-study-line=""
      data-study-line-state={restsMinimal ? "resting" : "chips"}
      role="toolbar"
      aria-label="Studies"
      aria-orientation="horizontal"
      onKeyDown={handleLineKeyDown}
    >
      <div
        ref={chipsRef}
        className={`scripture-study-line-chips${scrollEdges.left ? " is-scrollable-left" : ""}${scrollEdges.right ? " is-scrollable-right" : ""}`}
      >
        {/* THERE IS NO "ALL" CHIP, and there is no all-studies view. It was
            built on 2026-07-30 and removed the same day: the strip holds one
            study's tabs, so All would have been a second way of arranging a row
            that has one arrangement, and a chip that is not a study standing
            first among the studies is exactly the "filter bar" this line is
            not. Every tab in every study is one press away in the overview,
            which is a list and does not pretend to be a place. */}
        {chips.map((chip) => (renameGroupId === chip.groupId ? (
          <form
            className="scripture-study-rename"
            data-study-line-rename=""
            key={chip.groupId}
            onSubmit={(event) => {
              event.preventDefault();
              void commitRename(chip.groupId, true);
            }}
          >
            <input
              ref={renameInputRef}
              value={renameDraft}
              maxLength={60}
              autoFocus
              autoComplete="off"
              aria-label={`Name this study — currently ${chip.label}`}
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
              onBlur={() => { void commitRename(chip.groupId, false); }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // Escape abandons the name and leaves the study as it was. An
                // unnamed study keeps its derived reference — "Acts 19" — which
                // is a true name, and never "This study".
                event.preventDefault();
                event.stopPropagation();
                endRename();
                focusStop(studyStop(chip.groupId));
              }}
            />
          </form>
        ) : (
          <button
            ref={registerStop(studyStop(chip.groupId))}
            type="button"
            className="scripture-study-chip"
            data-study-line-chip=""
            data-study-group-id={chip.groupId}
            /* THE CHIP IS A LIVE TARGET, in the ink the strip already drops
               tabs in: the same 2px secondary-ink rule, laid along the chip's
               baseline instead of standing between two tabs. No fill, no glow,
               no dashed outline — a drop target that lights up is a browser
               telling you it is a browser, and the register was drawn to
               refuse that. The strip decides when this is on; the chip only
               wears it. */
            data-study-drop-target={dropTargetStudyId === chip.groupId || undefined}
            // At the floor there is one study and nothing to be current AMONG,
            // so the resting line states no selection: `aria-current` on the
            // only option is an answer to a question nobody asked.
            aria-current={(!restsMinimal && chip.current) || undefined}
            // The name carries the state, and that is how a switch is
            // announced: activation happens on the focused chip, so the focused
            // control's accessible name changes underneath the reader. It is
            // the same mechanism the strip uses to announce a fold, chosen for
            // the same reason — the fact is already on screen, and a live
            // region would say it a second time on every ⌘1 as well.
            aria-label={chip.current && !restsMinimal
              ? `${chip.label}, ${chip.tabCount} ${chip.tabCount === 1 ? "tab" : "tabs"}, showing`
              : `${chip.label}, ${chip.tabCount} ${chip.tabCount === 1 ? "tab" : "tabs"}`}
            title={`${chip.label} — ${chip.tabCount} ${chip.tabCount === 1 ? "tab" : "tabs"}`}
            aria-keyshortcuts="F2"
            // No `aria-haspopup`, for the reason the strip's tabs carry none:
            // the chip's primary activation is a study, and announcing a popup
            // on a control whose Enter switches studies promises a key that
            // does not exist. A context menu is reached by the gesture and the
            // key the platform already reserves for one.
            tabIndex={rovingKey === studyStop(chip.groupId) ? 0 : -1}
            onFocus={() => setFocusedKey(studyStop(chip.groupId))}
            onContextMenu={(event) => {
              // The strip's idiom, one row up: a menu at the pointer, on the
              // shared float, with the same three shapes of item. What it
              // offers is what a chip already IS — the study's name, its
              // tabs, and its life — so nothing here is a second way to do
              // something the model does not already do.
              //
              // It serves both devices with one handler, because the platform
              // already routes both to it: the Menu key and Shift+F10 fire
              // `contextmenu` on the focused element, so the chip the roving
              // stop is on opens its own menu with no second key path invented
              // here.
              event.preventDefault();
              endRename();
              setFocusedKey(studyStop(chip.groupId));
              setChipMenu({
                groupId: chip.groupId,
                anchor: new DOMRect(event.clientX, event.clientY, 0, 0),
              });
            }}
            onMouseDown={(event) => {
              // Keeping focus where it is stops the roving stop jumping on a
              // press — right until a rename is open. Then the press must be
              // allowed to take focus, so the field blurs and commits before
              // this click lands anywhere.
              if (renameGroupId === null) event.preventDefault();
            }}
            onDoubleClick={() => beginRename(chip.groupId, chip.label)}
            onKeyDown={(event) => {
              if (event.key !== "F2") return;
              event.preventDefault();
              beginRename(chip.groupId, chip.label);
            }}
            onClick={() => { void openStudy(chip.groupId); }}
          >
            {/* THE SEAL MARKS A NAME, not a study. Every study is authored, so
                a mark on every chip distinguishes nothing and is a row of gold
                bars saying one thing over and over. What the reader actually
                did — the act Law 3's ink certifies — is give this study a name;
                a study still wearing its derived reference has been made and
                not yet claimed, and goes unmarked until it is. */}
            {chip.named && <span className="scripture-study-chip-seal" aria-hidden="true" />}
            <span className="scripture-study-chip-label" data-label={chip.label}>
              <span>{chip.label}</span>
            </span>
          </button>
        )))}
      </div>
      {/* Outside the scrolling row, against its end — the same arrangement the
          strip below uses for the control that makes a tab. Inside the row it
          scrolled away with the chips, so at eight studies the one control that
          makes a study was off the end of a row you had to pan to find, and at
          sixteen it was past a cap it was the only thing reporting. */}
      <Tooltip label={startTooltip}>
        <button
          ref={registerStop(START_STOP)}
          type="button"
          className="scripture-study-open"
          data-study-start=""
          data-study-start-disabled={atStudyCapacity || undefined}
          aria-disabled={atStudyCapacity || undefined}
          aria-label="Start a new study"
          tabIndex={rovingKey === START_STOP ? 0 : -1}
          onFocus={() => setFocusedKey(START_STOP)}
          onMouseDown={(event) => {
            if (renameGroupId === null) event.preventDefault();
          }}
          onClick={() => { if (!atStudyCapacity) void onStartStudy(); }}
        >
          <span aria-hidden="true"><PlusGlyph /></span>
        </button>
      </Tooltip>
      {/* THE CHIP'S MENU — the strip's context-menu idiom, one row up.
          It is the same primitive on the same float with the same class, the
          same `role="menu"` of plain menuitems, and the same rule about what
          may be in it: every item routes to a mutation that already exists and
          already refuses what it must. Rename opens the field F2 opens, in
          place, so there is still no dialog that asks a study for its name.
          Close study goes through `closeStudyWorkspaceGroup`, which refuses the
          last study and demands a confirmation for one holding several tabs —
          this menu adds no exception to either. */}
      {chipMenu && (() => {
        const group = workspace.groups.find((candidate) => candidate.id === chipMenu.groupId);
        if (!group) return null;
        const label = studyWorkspaceGroupLabel(workspace, group, bookNames);
        const closeAvailability = studyWorkspaceGroupCloseAvailability(workspace, group.id);
        return (
          <Popover
            anchorRect={chipMenu.anchor}
            onClose={() => dismissChipMenu(group.id)}
            width={244}
            maxHeight={360}
            className="scripture-workspace-context-popover"
            ariaLabel={`${label} actions`}
          >
            <div className="scripture-workspace-context-menu" role="menu" data-study-chip-menu="">
              <button
                type="button"
                role="menuitem"
                data-study-chip-rename=""
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setChipMenu(null);
                  beginRename(group.id, label);
                }}
              >Rename</button>
              <button
                type="button"
                role="menuitem"
                data-study-chip-new-tab=""
                onMouseDown={(event) => event.preventDefault()}
                onClick={async () => {
                  setChipMenu(null);
                  // A tab opens into the study the page is IN, so the page has
                  // to arrive first. A refused landing opens nothing: a tab in
                  // a study the reader never reached is worse than no tab.
                  if (await openStudy(group.id)) onNewTab();
                }}
              >New tab in this study</button>
              <button
                type="button"
                role="menuitem"
                data-study-chip-close=""
                data-study-close-availability={closeAvailability}
                disabled={closeAvailability === "unavailable"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={async () => {
                  setChipMenu(null);
                  await onCloseStudy(group.id);
                }}
              >{closeAvailability === "decision" ? "Close study…" : "Close study"}</button>
            </div>
          </Popover>
        );
      })()}
    </div>
  );
}
