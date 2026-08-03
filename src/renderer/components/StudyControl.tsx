import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookNameData } from "../api.js";
import {
  STUDY_WORKSPACE_GROUP_LIMIT,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceGroupLabel,
  studyWorkspaceTabPromoteAvailability,
  type StudyWorkspaceGroup,
  type StudyWorkspaceStateV2,
} from "../utils/studyWorkspace.js";
import { START_STUDY_TARGET } from "./ScriptureWorkspaceTabs.js";
import { Popover } from "./Popover.js";
import { Tooltip } from "./Tooltip.js";

/**
 * THE STUDY CONTROL — one object at the end of the register, and the only place
 * a study is named.
 *
 * It stood one row up until 2026-08-03, as a row of chips in the 24px band the
 * window is dragged by, and the maintainer named three faults in one sentence:
 * the chips sat under the traffic lights, the band could not be grabbed, and in
 * fullscreen the row lay flush against the screen's top edge where the menu bar
 * drops. Measured: the study line at `y 0–24`, its first chip at `x 56–116`, and
 * macOS `hiddenInset` putting the window buttons at roughly `x 14–66, y 14–26` —
 * so with the rail collapsed to 56 the green button was drawn over the first
 * chip.
 *
 * All three are one fault: the studies were living in the drag band. Rev 05
 * §05·2 had already ruled on it — "a label above the strip creates a second
 * strip. It belongs in the strip, at the head of its members" — and the study
 * line, added afterwards, WAS that second strip. So the band goes back to being
 * empty and draggable end to end, and the studies move down into the register.
 *
 * NOT AT THE HEAD OF ITS MEMBERS, though, because §05·2's own placement has been
 * tried twice and failed twice: a 96px box beside the first tab "clipped the
 * study name and shouldered a flush-start tab off the page's corner", and the
 * strip's right-hand cluster held a 132px-capped name that truncated "at exactly
 * the moment the name is the thing being read". Both failures are the same
 * failure — a study name given a fixed width — and refusing it is the rule this
 * control is built around.
 *
 * SO IT IS ONE CONTROL AND NOT A ROW, and that is what buys the name its width.
 * A row of chips in the register would compete with the tabs for the same
 * horizontal space and would have to pan, which is a second sideways-scrolling
 * region inside a 30px strip. One control at the right end never competes, so
 * the name is never capped: what is drawn is the active study's whole name, and
 * after it the number of studies standing behind it — `Acts · +5`.
 *
 * THE COUNT IS THE AFFORDANCE. Without it nothing on screen says a set exists,
 * and a feature reachable only by a gesture nobody mentions is a feature that is
 * not there — which is exactly what had happened to the playlist menu in the
 * Listen room. It counts the REST, never the total, and that is deliberate: the
 * `+n` tab count retired on 2026-07-30 failed because its number meant two
 * things at once, some of it a scroll you could pan away and the rest other
 * studies entirely. `+5` here means one thing.
 *
 * NO ⌘-NUMBER IS OFFERED. ⌘1–9 selects a TAB — app.tsx binds it through
 * `studyWorkspaceOrdinalTabId` — and printing a key beside a study that would
 * actually take you to a tab is the promise-a-key-that-does-not-exist fault the
 * chips refused `aria-haspopup` over. Each row carries its tab count instead,
 * which is a fact the model already holds.
 *
 * SELECTION STILL LEADS AND THE CONTROL FOLLOWS. It holds no state about which
 * study is current: that is read off `workspace.activeTabId`, so Ctrl+Tab, ⌘1–9,
 * reopening a closed tab and opening a connection into another study all move it
 * for free, and it can never disagree with the page.
 */

/** Warn on the start item once within this many studies of the hard cap. */
const STUDY_CAPACITY_HINT_THRESHOLD = 2;

export interface StudyChoice {
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

function CaretGlyph(): React.JSX.Element {
  return <svg className="scripture-study-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" /></svg>;
}

function TickGlyph(): React.JSX.Element {
  return <svg className="scripture-study-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 3 3 6-6.8" /></svg>;
}

/**
 * The study the control is standing on: the one the page is in.
 *
 * There is no filter and no state. Which study the strip shows and which study
 * this names are the same fact as which tab is active, which is why the control
 * cannot get out of step with the page.
 */
export function activeStudyGroupId(
  workspace: StudyWorkspaceStateV2,
): string | null {
  return workspace.tabsById[workspace.activeTabId]?.groupId ?? null;
}

/**
 * The tab a study lands on: the one it was last on.
 *
 * `lastActiveTabId` is maintained by `selectStudyWorkspaceTab` on every
 * selection and is exactly this fact, so it is read rather than reconstructed.
 * The two fallbacks are for a group whose record has been trimmed by a close:
 * the home passage every group is guaranteed to own, then the first surviving
 * member. Membership is double-booked — `tab.groupId` and `group.tabIds` — and a
 * tab whose two records disagree is inert everywhere else in the model, so it is
 * inert here too.
 */
export function studyLandingTabId(
  workspace: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
): string | null {
  const owns = (tabId: string): boolean => workspace.tabsById[tabId]?.groupId === group.id;
  if (owns(group.lastActiveTabId)) return group.lastActiveTabId;
  if (owns(group.homePassageTabId)) return group.homePassageTabId;
  return group.tabIds.find(owns) ?? null;
}

/** Every study, in the model's own group order. */
export function studyChoices(
  workspace: StudyWorkspaceStateV2,
  bookNames: BookNameData,
): StudyChoice[] {
  const currentId = activeStudyGroupId(workspace);
  return workspace.groups.map((group) => ({
    groupId: group.id,
    label: studyWorkspaceGroupLabel(workspace, group, bookNames),
    tabCount: group.tabIds.filter((tabId) => workspace.tabsById[tabId]?.groupId === group.id).length,
    current: group.id === currentId,
    named: group.label.kind === "custom",
  }));
}

export interface StudyControlProps {
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
   * What the strip's drag is doing, or null when there is none.
   *
   * The list opens on CARRY, and that is not a flourish — it is what keeps the
   * gesture alive. A tab is moved between studies by dragging it onto that
   * study's own target, and `studyDropTargetId` hit-tests the document for one;
   * with the chips gone there was exactly one target on screen, the study the
   * tab is already in, which that function excludes by design. The menu rows ARE
   * the targets, so the list has to be open while a carry is in flight or there
   * is nowhere to drop.
   *
   * IT OPENS ON CARRY AND NOT ON REORDER, as of 2026-08-03. It used to open the
   * moment any drag began, so sliding a tab two places along its own row hung a
   * 252px panel over the page about a decision the reader was not making. In
   * REORDER this control says one quieter thing instead — see the face — and the
   * list waits until the tab has actually left the row.
   */
  dragPhase: "reorder" | "carry" | null;
  /**
   * The tab in the air, so the start row can decide whether to offer itself.
   *
   * Founding a study from a tab is not always available — the model refuses it
   * for a research tab, and for the last passage in a study, because a study
   * with nothing left in it is not a study. That is
   * `studyWorkspaceTabPromoteAvailability`'s answer to give, so the tab travels
   * here and the row asks. A target that lit up and then refused would be worse
   * than one that never lit.
   */
  draggedTabId: string | null;
  /**
   * The study a tab is currently being dragged over, reported by the strip.
   *
   * It arrives as a prop rather than as state here for the reason this whole
   * component holds none: the gesture belongs to the strip, which owns the
   * pointer and the tab. The control paints what the pointer is over and knows
   * nothing else about the drag — least of all how to commit it.
   */
  dropTargetStudyId: string | null;
}

type MenuMode = "list" | "rename";

export function StudyControl({
  workspace,
  bookNames,
  onSelectTab,
  onRenameStudy,
  onCloseStudy,
  onStartStudy,
  onNewTab,
  namingRequest,
  dragPhase,
  draggedTabId,
  dropTargetStudyId,
}: StudyControlProps): React.JSX.Element | null {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [mode, setMode] = useState<MenuMode>("list");
  const [renameDraft, setRenameDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const namingNonceRef = useRef<number | null>(null);
  const pendingIntentRef = useRef(false);

  const choices = useMemo(() => studyChoices(workspace, bookNames), [bookNames, workspace]);
  const current = choices.find((choice) => choice.current) ?? choices[0] ?? null;
  const others = Math.max(0, choices.length - 1);
  const open = anchor !== null;

  const openMenu = useCallback((next: MenuMode): void => {
    const node = buttonRef.current;
    if (!node) return;
    setMode(next);
    setAnchor(node.getBoundingClientRect());
  }, []);

  /* CLOSING PUTS THE READER BACK ON THE CONTROL. The popover portals to the
     document body and takes focus, so without this a keyboard reader who opened
     the list and changed their mind is returned to `body` and has to tab the
     page again. Guarded on `isConnected` for the same reason the Listen room's
     menu is: committing a rename rerenders this, and focusing a node the engine
     has already dropped throws. */
  const closeMenu = useCallback((refocus: boolean): void => {
    setAnchor(null);
    setMode("list");
    if (!refocus) return;
    const node = buttonRef.current;
    if (node?.isConnected) node.focus();
  }, []);

  /* THE LIST OPENS ITSELF FOR A CARRY and closes when the drag ends. It takes
     no focus while it does — `initialFocus` is off below — because a pointer
     drag has not asked for the keyboard, and pulling focus mid-gesture would
     leave it somewhere arbitrary once the tab lands.

     A REORDER opens nothing. The reader is placing a tab among its siblings and
     the run itself answers that; a panel would be a second answer to a question
     already being answered, over the page, about studies they have not asked
     about. */
  useEffect(() => {
    if (dragPhase !== "carry") return;
    openMenu("list");
    return () => { setAnchor(null); setMode("list"); };
  }, [dragPhase, openMenu]);

  /* A study is born unnamed and the reader is invited to name it at once. The
     invitation used to be a synthetic click on the strip's Manage control, which
     opened a dialog over the page to ask for four words; it is this control's
     own field now, so the request is a nonce rather than a DOM handshake. */
  useEffect(() => {
    if (!namingRequest) return;
    if (namingNonceRef.current === namingRequest.nonce) return;
    namingNonceRef.current = namingRequest.nonce;
    const group = workspace.groups.find((candidate) => candidate.id === namingRequest.groupId);
    if (!group) return;
    setRenameDraft(studyWorkspaceGroupLabel(workspace, group, bookNames));
    openMenu("rename");
  }, [bookNames, namingRequest, openMenu, workspace]);

  /* The field opens with the old name selected, so the first keystroke replaces
     it — a study is usually being named rather than edited.

     ON FOCUS, not in a layout effect, and the difference is a race this lost.
     The popover focuses the field itself, in its own layout effect, and a parent
     that selects in one of its own is only correct while the two run in that
     order — which they did until the popover re-ran its effect and focused a
     second time, collapsing the selection to a caret. Selecting where focus
     actually lands cannot be out of order with focus. */

  /* A study that closes while its name is being edited takes the field with it.
     No surface may go on standing for a study that is not there. */
  useEffect(() => {
    if (!open || current) return;
    closeMenu(false);
  }, [closeMenu, current, open]);

  /**
   * Open a study.
   *
   * It asks for ONE thing: the tab that study was last on. There is no filter —
   * the strip shows the study the page is in, so the register follows the
   * selection exactly as the page does, and a refused selection changes nothing
   * anywhere, which is the only honest outcome for a refusal.
   *
   * The return value is for "New tab in this study" alone: a tab opens into the
   * study the page is IN, so a refused landing must not be followed by opening
   * one somewhere else.
   */
  const openStudy = useCallback(async (groupId: string): Promise<boolean> => {
    if (pendingIntentRef.current) return false;
    const group = workspace.groups.find((candidate) => candidate.id === groupId);
    if (!group) return false;
    pendingIntentRef.current = true;
    try {
      const landing = studyLandingTabId(workspace, group);
      if (landing && landing !== workspace.activeTabId) return await onSelectTab(landing);
      return landing !== null;
    } finally {
      pendingIntentRef.current = false;
    }
  }, [onSelectTab, workspace]);

  const commitRename = useCallback(async (): Promise<void> => {
    const groupId = current?.groupId;
    const trimmed = renameDraft.trim();
    closeMenu(true);
    if (groupId && trimmed) await onRenameStudy(groupId, trimmed);
  }, [closeMenu, current, onRenameStudy, renameDraft]);

  const studyCount = workspace.groups.length;
  const atStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT;
  const nearStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT - STUDY_CAPACITY_HINT_THRESHOLD;
  // The cap this item meets is STUDY_WORKSPACE_GROUP_LIMIT and the copy says
  // studies — the same shape the tab plus uses for its own 64, in its own unit.
  // A limit stated in the wrong unit is worse than an unstated one.
  const startLabel = atStudyCapacity
    ? `All ${STUDY_WORKSPACE_GROUP_LIMIT} studies open`
    : nearStudyCapacity
      ? `Start a new study — ${studyCount} of ${STUDY_WORKSPACE_GROUP_LIMIT} open`
      : "Start a new study";

  const tabWord = (count: number): string => `${count} ${count === 1 ? "tab" : "tabs"}`;
  /* NO PLACEHOLDER NAME. `current?.label ?? "This study"` stood here for an hour
     and the premium contract caught it, which is exactly what that assertion is
     for: "This study" is the rail switcher's retired placeholder, and every
     study has a name it can be told apart by — a derived reference like "Acts
     19" if the reader has not given it one, never a pronoun.

     The model guarantees at least one group, so this branch is unreachable in a
     valid workspace. What it must not do when it is reached is invent a name for
     something that is not there: a control naming no study draws nothing. */
  if (!current) return null;
  const label = current.label;
  const tabs = tabWord(current.tabCount);
  const otherWord = `${others} other ${others === 1 ? "study" : "studies"}`;
  const closeAvailability = studyWorkspaceGroupCloseAvailability(workspace, current.groupId);

  /* THE NAME BECOMES AN INVITATION WHILE A TAB IS IN THE AIR.

     A reorder opens no list — see the effect above — which left this control
     saying nothing at all during the one gesture it is the destination for. So
     the study's name gives its place up for the length of the drag and the
     control says what it is FOR instead. The reader is already holding the tab;
     the only thing they are missing is that this is somewhere to put it.

     It is a swap of copy in a control that is already there, not a thing that
     appears: nothing is added to the frame, nothing moves beside it, and the
     control keeps its own ground and its own box. It says it once and holds it —
     no pulse, no loop. A hint that repeats itself is a hint that does not trust
     the reader to have read it, and this app has refused that everywhere else.

     The accessible name follows the visible one, because they are the same
     sentence and a screen reader is in the middle of the same gesture. */
  const inviting = dragPhase !== null;
  const hint = "Drag here to change study";

  /* AND THE START ROW BECOMES A DESTINATION, when the tab in the air could
     actually found a study with it.

     It is the same drop the rest of the list takes, routed to the mutation the
     tab menu's "New study from this tab" already uses — Safari's
     drag-a-tab-out-to-a-new-window, mapped onto studies. What it does not have
     is a group id, because the group is what the drop would create; it borrows a
     sentinel, which travels every pipe the real ids travel and is read back at
     exactly one place, the drop.

     GATED, because a target that lights up and then refuses is worse than one
     that never lights. The model says no to a research tab and to the last
     passage in a study — a study with nothing left in it is not a study — and
     that answer is its to give, so it is asked rather than guessed at. */
  const canFound = dragPhase === "carry"
    && draggedTabId !== null
    && studyWorkspaceTabPromoteAvailability(workspace, draggedTabId) === "direct";

  return (
    <div className="scripture-study-control" data-study-control="">
      <Tooltip label={others > 0 ? `${label} — ${tabs} · ${otherWord}` : `${label} — ${tabs}`}>
        <button
          ref={buttonRef}
          type="button"
          className="scripture-study-face"
          data-study-face=""
          data-study-face-open={open || undefined}
          data-study-face-inviting={inviting || undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          /* The name carries the state, and that is how a switch is announced:
             the focused control's accessible name changes underneath the reader.
             It is the same mechanism the strip uses to announce a fold, chosen
             for the same reason — the fact is already on screen, and a live
             region would say it a second time on every ⌘1 as well. */
          aria-label={inviting
            ? hint
            : others > 0
              ? `Study: ${label}, ${tabs}, ${otherWord}`
              : `Study: ${label}, ${tabs}`}
          aria-keyshortcuts="F2"
          onKeyDown={(event) => {
            if (event.key !== "F2") return;
            event.preventDefault();
            setRenameDraft(label);
            openMenu("rename");
          }}
          onClick={() => { if (open) closeMenu(true); else openMenu("list"); }}
        >
          {/* THE SEAL MARKS A NAME, not a study. Every study is authored, so a
              mark on every one distinguishes nothing. What the reader actually
              did — the act Law 3's ink certifies — is give this study a name; a
              study still wearing its derived reference has been made and not yet
              claimed, and goes unmarked until it is. */}
          {inviting ? (
            <span className="scripture-study-invite" data-study-invite="">{hint}</span>
          ) : (
            <>
              {current.named && <span className="scripture-study-seal" aria-hidden="true" />}
              <span className="scripture-study-name">{label}</span>
              {others > 0 && (
                <span className="scripture-study-rest" aria-hidden="true">{`+${others}`}</span>
              )}
              <CaretGlyph />
            </>
          )}
        </button>
      </Tooltip>

      {open && (
        <Popover
          anchorRect={anchor}
          onClose={() => closeMenu(dragPhase === null)}
          width={252}
          maxHeight={420}
          initialFocus={dragPhase === null}
          {...(mode === "rename" ? { initialFocusRef: renameInputRef } : {})}
          className="scripture-workspace-context-popover"
          ariaLabel={mode === "rename" ? `Name this study — currently ${label}` : "Studies"}
        >
          {mode === "rename" ? (
            /* RENAMING MOVED OFF THE NAME ITSELF, and the trade is worth stating.
               The chip became its own field in place, which was the thing that
               replaced a dialog asking a study for four words. There is no chip
               now, and expanding this control into a field would push the save
               status and the All Tabs door sideways for the length of a rename.
               So the field opens in the surface the control already owns,
               anchored to it, pre-filled and selected — beside the name rather
               than on it, and still nothing over the page asking a question. */
            <form
              className="scripture-study-rename"
              data-study-rename=""
              onSubmit={(event) => {
                event.preventDefault();
                void commitRename();
              }}
            >
              <input
                ref={renameInputRef}
                value={renameDraft}
                maxLength={60}
                autoComplete="off"
                aria-label={`Name this study — currently ${label}`}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  // Escape abandons the name and leaves the study as it was. An
                  // unnamed study keeps its derived reference — "Acts 19" —
                  // which is a true name, and never "This study".
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu(true);
                }}
              />
              <div className="scripture-study-rename-actions">
                <button type="button" data-study-rename-cancel="" onClick={() => closeMenu(true)}>Cancel</button>
                {/* Disabled on a blank name rather than allowed and ignored: the
                    store trims and returns silently, so a live button would close
                    the field, change nothing, and leave the reader having watched
                    a control succeed at doing that. */}
                <button type="submit" data-study-rename-save="" disabled={renameDraft.trim().length === 0}>Save</button>
              </div>
            </form>
          ) : (
            <div className="scripture-workspace-context-menu is-studies" role="menu" data-study-menu="">
              {choices.map((choice) => {
                /* WHAT IT WILL BE, not where the pointer is · 2026-08-03.
                   A drop indicator that says only "here" is a rule under a row;
                   the reader still has to work out what the drop DOES. The count
                   is already on the row, so the row can answer instead: while a
                   tab is over it, the number it shows is the number this study
                   will hold once the tab lands. Positive, exact, and drawn with
                   something already there rather than with new furniture.

                   It says what the gesture is FOR even when the model will stop
                   to ask — a home passage tab needs a confirmation, and the
                   count is still the honest statement of the intent being
                   confirmed. */
                const landing = dropTargetStudyId === choice.groupId;
                return (
                <button
                  key={choice.groupId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.current}
                  className="scripture-study-row"
                  /* THE ROW IS THE DROP TARGET. `studyDropTargetId` hit-tests the
                     document for this attribute, because the drag sets pointer
                     capture on the tab and a captured pointer sends its events to
                     the capturing element — these rows never see one.
                     `elementFromPoint` asks the question capture cannot answer,
                     and this attribute is what it can answer with. */
                  data-study-target=""
                  data-study-group-id={choice.groupId}
                  data-study-drop-target={landing || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    closeMenu(true);
                    void openStudy(choice.groupId);
                  }}
                >
                  <span className="scripture-study-row-tick" aria-hidden="true">
                    {choice.current ? <TickGlyph /> : null}
                  </span>
                  {/* BOTH MARKS KEEP THEIR COLUMN WHETHER OR NOT THEY DRAW. The
                      seal is on named studies only, so rendering it inline left
                      an unnamed row's name hanging two pixels left of every
                      other one — a ragged left edge in a list of four words,
                      which reads as a rendering fault rather than as an absence
                      of provenance. The slot is always here; what varies is
                      whether anything is in it. */}
                  <span className="scripture-study-row-seal" aria-hidden="true">
                    {choice.named ? <span className="scripture-study-seal" /> : null}
                  </span>
                  <span className="scripture-study-row-name">{choice.label}</span>
                  <span className="scripture-study-row-count" aria-hidden="true">
                    {landing ? choice.tabCount + 1 : choice.tabCount}
                  </span>
                </button>
                );
              })}
              <div className="scripture-study-menu-rule" role="separator" />
              {/* Every item routes to a mutation that already exists and already
                  refuses what it must. Close study goes through
                  `closeStudyWorkspaceGroup`, which refuses the last study and
                  demands a confirmation for one holding several tabs — this menu
                  adds no exception to either. */}
              <button
                type="button"
                role="menuitem"
                data-study-rename-open=""
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setRenameDraft(label); setMode("rename"); }}
              >Rename…</button>
              <button
                type="button"
                role="menuitem"
                data-study-new-tab=""
                onMouseDown={(event) => event.preventDefault()}
                onClick={async () => {
                  const groupId = current?.groupId;
                  closeMenu(true);
                  // A tab opens into the study the page is IN, so the page has to
                  // arrive first. A refused landing opens nothing: a tab in a
                  // study the reader never reached is worse than no tab.
                  if (groupId && await openStudy(groupId)) onNewTab();
                }}
              >New tab in this study</button>
              <button
                type="button"
                role="menuitem"
                data-study-close=""
                data-study-close-availability={closeAvailability}
                disabled={closeAvailability === "unavailable"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={async () => {
                  const groupId = current?.groupId;
                  closeMenu(true);
                  if (groupId) await onCloseStudy(groupId);
                }}
              >{closeAvailability === "decision" ? "Close study…" : "Close study"}</button>
              <div className="scripture-study-menu-rule" role="separator" />
              {/* At capacity it stays put and stops responding, exactly as the tab
                  plus does at 64 — a control that vanishes at the limit teaches
                  that the limit is a bug. */}
              <button
                type="button"
                role="menuitem"
                data-study-start=""
                data-study-start-disabled={atStudyCapacity || undefined}
                aria-disabled={atStudyCapacity || undefined}
                {...(canFound ? {
                  "data-study-target": "",
                  "data-study-group-id": START_STUDY_TARGET,
                  "data-study-drop-target": dropTargetStudyId === START_STUDY_TARGET || undefined,
                } : {})}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (atStudyCapacity) return;
                  closeMenu(true);
                  void onStartStudy();
                }}
              >
                <span className="scripture-study-start-glyph" aria-hidden="true"><PlusGlyph /></span>
                {startLabel}
              </button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
