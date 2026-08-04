import {
  createNavigationHistory,
  NAVIGATION_HISTORY_LIMIT,
  pushNavigationHistory,
  type NavigationHistoryEntry,
  type NavigationHistoryState,
  type NavigationMarginTab,
} from "./navigationHistory.js";

export type EntityWorkspaceKind = "person" | "place" | "other";

export interface PackageSelectionSnapshot {
  packageId: string;
  pieces: Array<{
    verse: number;
    charStart: number | null;
    charEnd: number | null;
  }>;
}

export interface PassageViewState extends NavigationHistoryEntry {
  selection?: PackageSelectionSnapshot;
  margin: NavigationHistoryEntry["margin"] & {
    scrollTopByTab: Partial<Record<NavigationMarginTab, number>>;
    wordsVerse?: number;
    wordsFollowingReading: boolean;
  };
}

export interface PassageWorkspaceSession {
  current: PassageViewState;
  history: NavigationHistoryState<PassageViewState>;
}

export interface PassageWorkspaceTab {
  kind: "passage";
  id: string;
  groupId: string;
  session: PassageWorkspaceSession;
}

export interface EntityResearchTrailEntry {
  id: string;
  displayName: string;
  kind?: EntityWorkspaceKind;
}

export interface EntityWorkspaceTab {
  kind: "entity";
  id: string;
  groupId: string;
  entityId: string;
  entityKind: EntityWorkspaceKind;
  readonly origin: PassageViewState;
  readonly originRange?: { start: number; end: number };
  canvas: PassageWorkspaceSession;
  returnPassageTabId: string | null;
  trail: EntityResearchTrailEntry[];
  scrollTop: number;
  nonce: number;
}

export interface EntityWorkspaceNonceSnapshot {
  tabId: string;
  nonce: number;
}

export type StudyWorkspaceTab = PassageWorkspaceTab | EntityWorkspaceTab;

export type ClosedStudyItem =
  | { kind: "tab"; tab: StudyWorkspaceTab; index: number }
  | {
      kind: "group";
      group: StudyWorkspaceGroup;
      tabsById: Record<string, StudyWorkspaceTab>;
      index: number;
    };

export interface StudyWorkspaceGroup {
  id: string;
  homePassageTabId: string;
  tabIds: string[];
  lastActiveTabId: string;
  collapsed: boolean;
  label:
    | { kind: "automatic"; frozenReference?: { book: string; chapter: number } }
    | { kind: "custom"; value: string };
}

export interface StudyWorkspaceStateV2 {
  version: 2;
  groups: StudyWorkspaceGroup[];
  tabsById: Record<string, StudyWorkspaceTab>;
  activeTabId: string;
  activationOrder: string[];
  recentlyClosed: ClosedStudyItem[];
}

export interface CreateStudyWorkspaceIds {
  groupId: string;
  passageTabId: string;
}

export interface OpenPassageWorkspaceInput {
  id: string;
  sourceTabId: string;
  view: PassageViewState;
  duplicate?: boolean;
}

export interface OpenPassageWorkspaceResult {
  state: StudyWorkspaceStateV2;
  outcome: "opened" | "focused" | "tab-limit" | "unchanged";
}

export type WorkspaceMutationOutcome =
  | "opened"
  | "focused"
  | "applied"
  | "tab-limit"
  | "group-limit"
  | "needs-confirmation"
  | "unchanged";

export type WorkspaceCloseAvailability = "direct" | "decision" | "unavailable";

export type WorkspaceConfirmation =
  | {
      kind: "passage-dependencies";
      tabId: string;
      dependentEntityIds: string[];
      entityNonces: EntityWorkspaceNonceSnapshot[];
      sourceGroupId: string;
      sourceTabIds: string[];
    }
  | {
      kind: "sole-group-passage";
      groupId: string;
      tabId: string;
      tabIds: string[];
      entityNonces: EntityWorkspaceNonceSnapshot[];
    }
  | {
      kind: "close-study";
      groupId: string;
      tabIds: string[];
      entityNonces: EntityWorkspaceNonceSnapshot[];
    }
  | {
      kind: "move-branch";
      tabId: string;
      dependentEntityIds: string[];
      entityNonces: EntityWorkspaceNonceSnapshot[];
      sourceGroupId: string;
      sourceTabIds: string[];
      targetGroupId: string;
      /** Where in the target study the drop asked for; absent when a menu
       *  named the study and said nothing about position. */
      slot?: number;
    }
  | {
      kind: "move-entity-context";
      tabId: string;
      sourceGroupId: string;
      nonce: number;
      targetGroupId: string;
      /** Where in the target study the drop asked for; absent when a menu
       *  named the study and said nothing about position. */
      slot?: number;
    }
  | {
      kind: "move-home-passage";
      tabId: string;
      groupId: string;
      sourceTabIds: string[];
      entityNonces: EntityWorkspaceNonceSnapshot[];
      targetGroupId: string;
      /** Where in the target study the drop asked for; absent when a menu
       *  named the study and said nothing about position. */
      slot?: number;
    };

export type WorkspaceDecision =
  | "close-passage-and-research"
  | "keep-research"
  | "close-study"
  | "keep-open"
  | "move-branch"
  | "copy-origin-passage"
  | "move-study"
  | "duplicate-home"
  | "cancel";

export type WorkspaceMutationResult =
  | {
      state: StudyWorkspaceStateV2;
      outcome: Exclude<WorkspaceMutationOutcome, "needs-confirmation">;
    }
  | {
      state: StudyWorkspaceStateV2;
      outcome: "needs-confirmation";
      confirmation: WorkspaceConfirmation;
    };

export interface OpenEntityWorkspaceInput {
  id: string;
  sourceTabId: string;
  entityId: string;
  /** Human-readable catalog name retained even when later lookup is unavailable. */
  displayName?: string;
  entityKind: EntityWorkspaceKind;
  nonce: number;
  origin: PassageViewState;
  originRange?: { start: number; end: number };
  returnPassageTabId: string | null;
  duplicate?: boolean;
}

export interface BranchEntityWorkspaceInput {
  id: string;
  sourceTabId: string;
  entry: EntityResearchTrailEntry;
  nonce: number;
}

export interface ReturnEntityWorkspaceToOriginInput {
  entityTabId: string;
  passageTabId?: string;
}

export interface StudyWorkspaceBookNames {
  readonly [bookCode: string]: readonly string[] | undefined;
}

export const ENTITY_RESEARCH_TRAIL_LIMIT = 12;
export const STUDY_WORKSPACE_TAB_LIMIT = 64;
export const STUDY_WORKSPACE_GROUP_LIMIT = 16;
export const RECENTLY_CLOSED_STUDY_LIMIT = 10;

function reservedStudyWorkspaceTabIds(state: StudyWorkspaceStateV2): Set<string> {
  const reserved = new Set(Object.keys(state.tabsById));
  for (const item of state.recentlyClosed) {
    if (item.kind === "tab") {
      reserved.add(item.tab.id);
      continue;
    }
    for (const tabId of item.group.tabIds) reserved.add(tabId);
    for (const tabId of Object.keys(item.tabsById)) reserved.add(tabId);
  }
  return reserved;
}

function availableDerivedTabId(
  state: StudyWorkspaceStateV2,
  baseId: string,
): string {
  const reserved = reservedStudyWorkspaceTabIds(state);
  if (!reserved.has(baseId)) return baseId;
  let suffix = 2;
  while (reserved.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function appendRecentlyClosedItems(
  current: readonly ClosedStudyItem[],
  additions: readonly ClosedStudyItem[],
): ClosedStudyItem[] {
  return [...current, ...additions]
    .slice(-RECENTLY_CLOSED_STUDY_LIMIT)
    .map(cloneClosedStudyItem);
}

function cloneEntityResearchTrailEntry(
  entry: EntityResearchTrailEntry,
): EntityResearchTrailEntry {
  return { ...entry };
}

export function appendEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  entry: EntityResearchTrailEntry,
): EntityResearchTrailEntry[] {
  const clonedTrail = trail.map(cloneEntityResearchTrailEntry);
  const current = clonedTrail.at(-1);
  const clonedEntry = cloneEntityResearchTrailEntry(entry);
  if (current?.id === entry.id) {
    const checkpoint = clonedEntry.kind === undefined && current.kind !== undefined
      ? { ...clonedEntry, kind: current.kind }
      : clonedEntry;
    const updated = current.displayName === checkpoint.displayName && current.kind === checkpoint.kind
      ? clonedTrail
      : [...clonedTrail.slice(0, -1), checkpoint];
    return updated.slice(-ENTITY_RESEARCH_TRAIL_LIMIT);
  }
  return [...clonedTrail, clonedEntry].slice(-ENTITY_RESEARCH_TRAIL_LIMIT);
}

export function truncateEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  index: number,
): EntityResearchTrailEntry[] {
  if (index < 0 || index >= trail.length) return [...trail];
  return trail.slice(0, index + 1);
}

function entityResearchTrailsEqual(
  left: readonly EntityResearchTrailEntry[],
  right: readonly EntityResearchTrailEntry[],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index];
    return entry.id === candidate?.id
      && entry.displayName === candidate.displayName
      && entry.kind === candidate.kind;
  });
}

function canonicalEntityResearchTrail(
  entries: readonly EntityResearchTrailEntry[],
): EntityResearchTrailEntry[] {
  return entries.reduce<EntityResearchTrailEntry[]>(
    (trail, entry) => appendEntityResearchTrail(trail, entry),
    [],
  );
}

function clonePassageViewState(view: PassageViewState): PassageViewState {
  return {
    ...view,
    ...(view.selection
      ? {
          selection: {
            packageId: view.selection.packageId,
            pieces: view.selection.pieces.map((piece) => ({ ...piece })),
          },
        }
      : {}),
    margin: {
      ...view.margin,
      scope: view.margin.scope ? { ...view.margin.scope } : null,
      scrollTopByTab: { ...view.margin.scrollTopByTab },
    },
  };
}

function normalizePassageWorkspaceSession(
  session: PassageWorkspaceSession,
): PassageWorkspaceSession {
  const backLength = Math.min(session.history.back.length, NAVIGATION_HISTORY_LIMIT);
  const forwardLength = Math.min(
    session.history.forward.length,
    NAVIGATION_HISTORY_LIMIT - backLength,
  );
  if (backLength === session.history.back.length
    && forwardLength === session.history.forward.length) {
    return session;
  }
  return {
    ...session,
    history: {
      back: session.history.back.slice(-backLength),
      forward: session.history.forward.slice(0, forwardLength),
    },
  };
}

function normalizeStudyWorkspaceTab(tab: StudyWorkspaceTab): StudyWorkspaceTab {
  if (tab.kind === "passage") {
    const session = normalizePassageWorkspaceSession(tab.session);
    return session === tab.session ? tab : { ...tab, session };
  }
  const canvas = normalizePassageWorkspaceSession(tab.canvas);
  const trail = tab.trail.length > ENTITY_RESEARCH_TRAIL_LIMIT
    ? tab.trail.slice(-ENTITY_RESEARCH_TRAIL_LIMIT)
    : tab.trail;
  return canvas === tab.canvas && trail === tab.trail ? tab : { ...tab, canvas, trail };
}

function clonePassageWorkspaceSession(
  session: PassageWorkspaceSession,
): PassageWorkspaceSession {
  const normalized = normalizePassageWorkspaceSession(session);
  return {
    current: clonePassageViewState(normalized.current),
    history: {
      back: normalized.history.back.map(clonePassageViewState),
      forward: normalized.history.forward.map(clonePassageViewState),
    },
  };
}

function cloneStudyWorkspaceTab(tab: StudyWorkspaceTab): StudyWorkspaceTab {
  if (tab.kind === "passage") {
    return { ...tab, session: clonePassageWorkspaceSession(tab.session) };
  }
  return {
    ...tab,
    origin: clonePassageViewState(tab.origin),
    ...(tab.originRange ? { originRange: { ...tab.originRange } } : {}),
    canvas: clonePassageWorkspaceSession(tab.canvas),
    trail: tab.trail.map(cloneEntityResearchTrailEntry),
  };
}

function cloneStudyWorkspaceGroup(group: StudyWorkspaceGroup): StudyWorkspaceGroup {
  return {
    ...group,
    tabIds: [...group.tabIds],
    label: group.label.kind === "custom"
      ? { kind: "custom", value: group.label.value }
      : group.label.frozenReference
        ? { kind: "automatic", frozenReference: { ...group.label.frozenReference } }
        : { kind: "automatic" },
  };
}

function cloneClosedStudyItem(item: ClosedStudyItem): ClosedStudyItem {
  if (item.kind === "tab") {
    return { kind: "tab", tab: cloneStudyWorkspaceTab(item.tab), index: item.index };
  }
  const tabsById: Record<string, StudyWorkspaceTab> = {};
  for (const [tabId, tab] of Object.entries(item.tabsById)) {
    tabsById[tabId] = cloneStudyWorkspaceTab(tab);
  }
  return {
    kind: "group",
    group: cloneStudyWorkspaceGroup(item.group),
    tabsById,
    index: item.index,
  };
}

export function createStudyWorkspace(
  initial: PassageViewState,
  ids: CreateStudyWorkspaceIds,
): StudyWorkspaceStateV2 {
  const tab: PassageWorkspaceTab = {
    kind: "passage",
    id: ids.passageTabId,
    groupId: ids.groupId,
    session: {
      current: clonePassageViewState(initial),
      history: createNavigationHistory<PassageViewState>(),
    },
  };
  return {
    version: 2,
    groups: [{
      id: ids.groupId,
      homePassageTabId: tab.id,
      tabIds: [tab.id],
      lastActiveTabId: tab.id,
      collapsed: false,
      label: { kind: "automatic" },
    }],
    tabsById: { [tab.id]: tab },
    activeTabId: tab.id,
    activationOrder: [tab.id],
    recentlyClosed: [],
  };
}

export function createStudyWorkspaceGroup(
  state: StudyWorkspaceStateV2,
  input: { id: string; passageTabId: string; view: PassageViewState },
): WorkspaceMutationResult {
  if (state.groups.some((group) => group.id === input.id) || state.tabsById[input.passageTabId]) {
    return { state, outcome: "unchanged" };
  }
  if (state.groups.length >= STUDY_WORKSPACE_GROUP_LIMIT) {
    return { state, outcome: "group-limit" };
  }
  if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
    return { state, outcome: "tab-limit" };
  }
  const tab: PassageWorkspaceTab = {
    kind: "passage",
    id: input.passageTabId,
    groupId: input.id,
    session: {
      current: clonePassageViewState(input.view),
      history: createNavigationHistory<PassageViewState>(),
    },
  };
  const group: StudyWorkspaceGroup = {
    id: input.id,
    homePassageTabId: tab.id,
    tabIds: [tab.id],
    lastActiveTabId: tab.id,
    collapsed: false,
    label: { kind: "automatic" },
  };
  return {
    state: {
      ...state,
      groups: [...state.groups, group],
      tabsById: { ...state.tabsById, [tab.id]: tab },
      activeTabId: tab.id,
      activationOrder: [...state.activationOrder.filter((id) => id !== tab.id), tab.id],
    },
    outcome: "opened",
  };
}

function activateStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  tabId: string,
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (!tab) return state;
  return {
    ...state,
    groups: state.groups.map((group) => group.id === tab.groupId
      ? { ...group, lastActiveTabId: tabId }
      : group),
    activeTabId: tabId,
    activationOrder: [...state.activationOrder.filter((id) => id !== tabId), tabId],
  };
}

function freezeAutomaticGroupLabel(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
): StudyWorkspaceGroup {
  if (group.label.kind !== "automatic" || group.label.frozenReference) return group;
  const home = state.tabsById[group.homePassageTabId];
  if (home?.kind !== "passage") return group;
  return {
    ...group,
    label: {
      kind: "automatic",
      frozenReference: {
        book: home.session.current.book,
        chapter: home.session.current.chapter,
      },
    },
  };
}

export function selectStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  tabId: string,
): StudyWorkspaceStateV2 {
  return activateStudyWorkspaceTab(state, tabId);
}

export function studyCanvasOwnerPassageTabId(
  state: StudyWorkspaceStateV2,
): string | null {
  const active = state.tabsById[state.activeTabId];
  if (active?.kind === "passage") return active.id;
  if (active?.kind === "entity") {
    const returnTab = active.returnPassageTabId
      ? state.tabsById[active.returnPassageTabId]
      : undefined;
    if (returnTab?.kind === "passage") return returnTab.id;
    const group = state.groups.find((candidate) => candidate.id === active.groupId);
    const home = group ? state.tabsById[group.homePassageTabId] : undefined;
    if (home?.kind === "passage") return home.id;
  }
  return [...state.activationOrder].reverse().find(
    (tabId) => state.tabsById[tabId]?.kind === "passage",
  ) ?? state.groups[0]?.homePassageTabId ?? null;
}

export function activateStudyCanvasOwnerPassageTab(
  state: StudyWorkspaceStateV2,
): StudyWorkspaceStateV2 {
  const ownerTabId = studyCanvasOwnerPassageTabId(state);
  if (!ownerTabId || ownerTabId === state.activeTabId) return state;
  return selectStudyWorkspaceTab(state, ownerTabId);
}

export function renameStudyWorkspaceGroup(
  state: StudyWorkspaceStateV2,
  groupId: string,
  value: string,
): StudyWorkspaceStateV2 {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group || (group.label.kind === "custom" && group.label.value === value)) return state;
  return {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === groupId
      ? { ...candidate, label: { kind: "custom", value } }
      : candidate),
  };
}

/**
 * WHERE A TAB IS BEING MOVED TO.
 *
 * The four words are a STEP, and they were the whole vocabulary because the only
 * things that reordered were a keyboard and a menu: "move left" means one place
 * left, and "start" and "end" are the two absolutes at the ends of that walk.
 *
 * A DRAG IS NOT A STEP, and this is what it was missing. Dragging the first tab
 * to the fourth slot went through `"right"` and landed it second — one step, as
 * asked, and not at all what the reader had just watched the run make room for.
 * The extremes worked, which is what made it look like a middle-of-the-run bug:
 * `"start"` and `"end"` are absolute and say the whole answer.
 *
 * So a slot joins them. The words keep their meaning for the devices that mean
 * them; a gesture that knows exactly where it landed says so.
 */
export type WorkspaceReorderPosition = "left" | "right" | "start" | "end" | { slot: number };

function reorderedIndex(
  current: number,
  length: number,
  position: WorkspaceReorderPosition,
): number {
  // Clamped rather than refused: the caller measured a run that may have changed
  // under an await, and the nearest legal slot is a better answer than none.
  if (typeof position === "object") return Math.max(0, Math.min(length - 1, position.slot));
  if (position === "start") return 0;
  if (position === "end") return length - 1;
  if (position === "left") return Math.max(0, current - 1);
  return Math.min(length - 1, current + 1);
}

export function reorderStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  input: { tabId: string; position: WorkspaceReorderPosition },
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[input.tabId];
  const group = tab
    ? state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !group) return state;
  const current = group.tabIds.indexOf(tab.id);
  const target = reorderedIndex(current, group.tabIds.length, input.position);
  if (target === current) return state;
  const tabIds = [...group.tabIds];
  tabIds.splice(current, 1);
  tabIds.splice(target, 0, tab.id);
  return {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? { ...candidate, tabIds }
      : candidate),
  };
}

export function reorderStudyWorkspaceGroup(
  state: StudyWorkspaceStateV2,
  input: { groupId: string; position: WorkspaceReorderPosition },
): StudyWorkspaceStateV2 {
  const current = state.groups.findIndex((group) => group.id === input.groupId);
  if (current < 0) return state;
  const target = reorderedIndex(current, state.groups.length, input.position);
  if (target === current) return state;
  const groups = [...state.groups];
  const [group] = groups.splice(current, 1);
  if (!group) return state;
  groups.splice(target, 0, group);
  return { ...state, groups };
}

/**
 * Open one study, and the others fold shut behind it.
 *
 * The register is a column, and every expanded study spends the same scarce
 * run of it. Left independent, opening a fourth study does not reveal a fourth
 * study — it pushes the first three off the top of a list the reader is trying
 * to read. Exclusivity makes the act of opening one mean what it looks like it
 * means: this is the study I am in now.
 *
 * No study is exempt, including the one holding the tab being read. Collapsing
 * does not hide it: a collapsed study keeps a proxy tab in the strip carrying
 * its own name, so the passage on screen is still named and still reachable —
 * ScriptureWorkspaceTabs says so where it withholds the kicker from a collapsed
 * study, "its proxy tab already carries the study's name". An exemption for the
 * reading study would also be an exemption in almost every real case, since the
 * study already open is usually the one being read, and the rule would quietly
 * never fire.
 *
 * Collapsing is unconditional and touches nothing else: shutting a study is not
 * a claim about any other study.
 */
export function toggleStudyWorkspaceGroup(
  state: StudyWorkspaceStateV2,
  groupId: string,
): StudyWorkspaceStateV2 {
  const target = state.groups.find((group) => group.id === groupId);
  if (!target) return state;
  const expanding = target.collapsed;
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id === groupId) return { ...group, collapsed: !group.collapsed };
      if (!expanding || group.collapsed) return group;
      return { ...group, collapsed: true };
    }),
  };
}

/**
 * Move tabs between studies, landing them at `slot` when the caller knows where.
 *
 * THE SLOT ARRIVED WITH THE DRAG. Every caller before it was a menu item —
 * "Move to study…" — and a menu naming a study has said nothing about where in
 * that study, so appending was the whole answer. A reader dragging a row has
 * said exactly where: they held it between two rows and let go, and watched a
 * gap open there while they did. Landing it at the end after that would be the
 * app disagreeing with a preview it had just drawn.
 *
 * Clamped against the KEPT tabs, which is what makes the two awkward callers
 * safe without either of them knowing about it. `move-entity-context` mints an
 * origin passage into the destination before the move, so a slot chosen against
 * the old list can be one short — clamping against the list as it stands now
 * absorbs that. And a slot recorded before a confirmation was answered may be
 * stale by any amount by the time the reader says yes; `reorderedIndex` clamps
 * for the same reason a few hundred lines up. Out of range is a landing at the
 * end, never a refusal: the move is what the reader asked for, the position was
 * only ever the fine print.
 */
function moveTabRecords(
  state: StudyWorkspaceStateV2,
  tabIds: readonly string[],
  sourceGroup: StudyWorkspaceGroup,
  targetGroup: StudyWorkspaceGroup,
  slot?: number,
): StudyWorkspaceStateV2 {
  const moving = new Set(tabIds);
  const frozenTargetGroup = freezeAutomaticGroupLabel(state, targetGroup);
  const sourceTabIds = sourceGroup.tabIds.filter((id) => !moving.has(id));
  const keptTargetTabIds = frozenTargetGroup.tabIds.filter((id) => !moving.has(id));
  // `move-branch` sends a block — the tab and the research hanging off it — and
  // a block lands whole at the slot rather than scattering around it.
  const landing = slot === undefined
    ? keptTargetTabIds.length
    : Math.max(0, Math.min(keptTargetTabIds.length, Math.trunc(slot)));
  const targetTabIds = [
    ...keptTargetTabIds.slice(0, landing),
    ...tabIds,
    ...keptTargetTabIds.slice(landing),
  ];
  const tabsById = { ...state.tabsById };
  for (const tabId of tabIds) {
    const tab = tabsById[tabId];
    if (tab) tabsById[tabId] = { ...tab, groupId: targetGroup.id };
  }
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id === sourceGroup.id) {
        return {
          ...group,
          tabIds: sourceTabIds,
          lastActiveTabId: sourceTabIds.includes(group.lastActiveTabId)
            ? group.lastActiveTabId
            : group.homePassageTabId,
        };
      }
      if (group.id === targetGroup.id) {
        return {
          ...frozenTargetGroup,
          tabIds: targetTabIds,
          lastActiveTabId: tabIds.includes(state.activeTabId)
            ? state.activeTabId
            : group.lastActiveTabId,
        };
      }
      return group;
    }),
    tabsById,
  };
}

export function moveStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  input: { tabId: string; targetGroupId: string; slot?: number },
): WorkspaceMutationResult {
  const tab = state.tabsById[input.tabId];
  const sourceGroup = tab
    ? state.groups.find((group) => group.id === tab.groupId && group.tabIds.includes(tab.id))
    : undefined;
  const targetGroup = state.groups.find((group) => group.id === input.targetGroupId);
  if (!tab || !sourceGroup || !targetGroup || sourceGroup.id === targetGroup.id) {
    return { state, outcome: "unchanged" };
  }
  if (tab.kind === "entity") {
    // Moving an entity may need to mint a fresh origin-passage tab in the
    // target group. If none already matches AND we are at the tab cap, refuse
    // up front so the copy-origin confirmation is never offered for an action
    // that resolution would only reject.
    const hasContextInTarget = targetGroup.tabIds.some((id) => {
      const candidate = state.tabsById[id];
      return candidate?.kind === "passage"
        && candidate.session.current.book === tab.origin.book
        && candidate.session.current.chapter === tab.origin.chapter
        && candidate.session.current.packageId === tab.origin.packageId;
    });
    if (!hasContextInTarget
      && Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
      return { state, outcome: "tab-limit" };
    }
    return {
      state,
      outcome: "needs-confirmation",
      confirmation: {
        kind: "move-entity-context",
        /* Spread rather than written, so a confirmation raised from a MENU has
           no `slot` key at all rather than one holding undefined. The menu named
           a study and said nothing about position; the shape should say that
           too. */
        ...(input.slot === undefined ? {} : { slot: input.slot }),
        tabId: tab.id,
        sourceGroupId: sourceGroup.id,
        nonce: tab.nonce,
        targetGroupId: targetGroup.id,
      },
    };
  }
  if (sourceGroup.homePassageTabId === tab.id
    || sourceGroup.tabIds.length === 1) {
    return {
      state,
      outcome: "needs-confirmation",
      confirmation: {
        kind: "move-home-passage",
        /* Spread rather than written, so a confirmation raised from a MENU has
           no `slot` key at all rather than one holding undefined. The menu named
           a study and said nothing about position; the shape should say that
           too. */
        ...(input.slot === undefined ? {} : { slot: input.slot }),
        tabId: tab.id,
        groupId: sourceGroup.id,
        sourceTabIds: [...sourceGroup.tabIds],
        entityNonces: entityNonceSnapshots(state, sourceGroup.tabIds),
        targetGroupId: targetGroup.id,
      },
    };
  }
  const dependentEntityIds = dependentEntityTabIds(state, sourceGroup, tab.id);
  if (dependentEntityIds.length > 0) {
    return {
      state,
      outcome: "needs-confirmation",
      confirmation: {
        kind: "move-branch",
        /* Spread rather than written, so a confirmation raised from a MENU has
           no `slot` key at all rather than one holding undefined. The menu named
           a study and said nothing about position; the shape should say that
           too. */
        ...(input.slot === undefined ? {} : { slot: input.slot }),
        tabId: tab.id,
        dependentEntityIds,
        entityNonces: entityNonceSnapshots(state, dependentEntityIds),
        sourceGroupId: sourceGroup.id,
        sourceTabIds: [...sourceGroup.tabIds],
        targetGroupId: targetGroup.id,
      },
    };
  }
  return {
    state: moveTabRecords(state, [tab.id], sourceGroup, targetGroup, input.slot),
    outcome: "applied",
  };
}

/**
 * May this tab found a study of its own?
 *
 * Three refusals, and each one is a shape the persisted model cannot hold
 * rather than a policy:
 *
 *   · an ENTITY tab cannot found one. Every group must own a passage — the
 *     validator reserves one per group and rejects a workspace without it —
 *     so a study made of research alone is not expressible.
 *   · a tab that is its study's ONLY passage cannot leave it. The study it
 *     left would have none, which is the same refusal from the other side, and
 *     the act would be a rename of the study you are already in rather than a
 *     new one.
 *   · sixteen studies is the cap, and it is reported in its own unit so the
 *     caller can say so.
 *
 * `"unavailable"` is a disabled menu item; `"study-limit"` is the same cap the
 * study line's + meets, and the caller reports it through the capacity lane.
 */
export function studyWorkspaceTabPromoteAvailability(
  state: StudyWorkspaceStateV2,
  tabId: string,
): "direct" | "study-limit" | "unavailable" {
  const tab = state.tabsById[tabId];
  const group = tab
    ? state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !group || tab.kind !== "passage") return "unavailable";
  const remainingPassages = group.tabIds.filter((candidateId) => (
    candidateId !== tab.id && state.tabsById[candidateId]?.kind === "passage"
  )).length;
  if (remainingPassages < 1) return "unavailable";
  if (state.groups.length >= STUDY_WORKSPACE_GROUP_LIMIT) return "study-limit";
  return "direct";
}

/**
 * A NEW STUDY FROM AN EXISTING TAB — the tab LEAVES, it is not copied.
 *
 * `createStudyWorkspaceGroup` is the + control's path and it mints a fresh
 * passage tab cloned from the view you are on, which is right for "start a
 * study here" and wrong for "this tab is its own study": it costs a tab slot,
 * and it leaves the original where it was so the reader ends up with two.
 * There was no move-into-a-NEW-group anywhere in the model — `moveStudyWorkspaceTab`
 * requires its target to already exist — and composing one out of create + move
 * + close fires a confirmation dialog for the common case, spends a tab against
 * the 64 cap, and leaves a placeholder in `recentlyClosed`. So this is a first
 * class mutation, and it reuses `moveTabRecords`' bookkeeping rather than
 * repeating it.
 *
 * RESEARCH TRAVELS WITH ITS PASSAGE, and that is a persistence requirement
 * rather than a courtesy. An entity tab's `returnPassageTabId` must name a
 * passage in its OWN group: the validator nulls a return link that points
 * outside the group (`study-workspace-settings.ts`, canonical tabs), the save
 * is a canonical-JSON round-trip equality check, and a rewritten payload fails
 * every subsequent write. Leaving a passage's dependents behind would therefore
 * not merely orphan them — it would stop the workspace saving. `move-branch`
 * moves them for the same reason.
 *
 * THE SOURCE RE-HOMES rather than refusing. If the promoted tab was its study's
 * home passage, the study it left takes the nearest remaining passage as its
 * home — exactly what `removeTabsFromGroup` does when a home passage is closed,
 * through the same helper. A group whose `homePassageTabId` is not among its
 * own tabs is another payload the validator rewrites.
 *
 * SELECTION FOLLOWS THE TAB. The new study is activated on the tab that founded
 * it, which is what makes the strip show it and what lets the caller open the
 * naming invitation on the new chip — the same two steps the + takes.
 */
export function promoteStudyWorkspaceTabToNewGroup(
  state: StudyWorkspaceStateV2,
  input: { tabId: string; groupId: string },
): WorkspaceMutationResult {
  const tab = state.tabsById[input.tabId];
  const sourceGroup = tab
    ? state.groups.find((group) => group.id === tab.groupId && group.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !sourceGroup || state.groups.some((group) => group.id === input.groupId)) {
    return { state, outcome: "unchanged" };
  }
  const availability = studyWorkspaceTabPromoteAvailability(state, tab.id);
  if (availability === "unavailable") return { state, outcome: "unchanged" };
  if (availability === "study-limit") return { state, outcome: "group-limit" };
  const dependents = dependentEntityTabIds(state, sourceGroup, tab.id);
  const moving = [tab.id, ...dependents];
  const homePassageTabId = sourceGroup.homePassageTabId === tab.id
    ? nearestRemainingPassageId(
        state,
        sourceGroup,
        new Set(moving),
        sourceGroup.tabIds.indexOf(tab.id),
      )
    : sourceGroup.homePassageTabId;
  if (!homePassageTabId) return { state, outcome: "unchanged" };
  const rehomedSource: StudyWorkspaceGroup = { ...sourceGroup, homePassageTabId };
  const born: StudyWorkspaceGroup = {
    id: input.groupId,
    homePassageTabId: tab.id,
    tabIds: [],
    lastActiveTabId: tab.id,
    collapsed: false,
    label: { kind: "automatic" },
  };
  const seeded: StudyWorkspaceStateV2 = {
    ...state,
    groups: [
      ...state.groups.map((group) => (group.id === sourceGroup.id ? rehomedSource : group)),
      born,
    ],
  };
  const moved = moveTabRecords(seeded, moving, rehomedSource, born);
  /* A STUDY BORN HERE IS BORN UNFROZEN when one tab founds it.
     `moveTabRecords` freezes an automatic destination label, because a study
     that GAINS a sibling should stop renaming itself every time its home tab
     navigates. A study founded by a single passage has no sibling yet — it is
     exactly the lone passage a live label is for — and the + control's new
     study is born unfrozen for the same reason. When research travels with the
     passage the study IS born with siblings, and the freeze already applied is
     the right one. */
  const settled = dependents.length === 0
    ? {
        ...moved,
        groups: moved.groups.map((group) => (group.id === born.id
          ? { ...group, label: { kind: "automatic" as const } }
          : group)),
      }
    : moved;
  return { state: activateStudyWorkspaceTab(settled, tab.id), outcome: "opened" };
}

function fallbackTabIdAfterRemoval(
  state: StudyWorkspaceStateV2,
  sourceGroup: StudyWorkspaceGroup,
  removedIndex: number,
  removed: ReadonlySet<string>,
): string | null {
  const remainingSource = sourceGroup.tabIds.filter((id) => !removed.has(id) && state.tabsById[id]);
  const nearest = remainingSource[removedIndex] ?? remainingSource[removedIndex - 1];
  if (nearest) return nearest;
  if (!removed.has(sourceGroup.homePassageTabId) && state.tabsById[sourceGroup.homePassageTabId]) {
    return sourceGroup.homePassageTabId;
  }
  const sourceGroupIndex = state.groups.findIndex((group) => group.id === sourceGroup.id);
  for (let distance = 1; distance < state.groups.length; distance += 1) {
    for (const groupIndex of [sourceGroupIndex + distance, sourceGroupIndex - distance]) {
      const group = state.groups[groupIndex];
      if (!group) continue;
      const valid = new Set(group.tabIds.filter((id) => !removed.has(id) && state.tabsById[id]));
      const recent = [...state.activationOrder].reverse().find((id) => valid.has(id));
      if (recent) return recent;
      if (valid.has(group.lastActiveTabId)) return group.lastActiveTabId;
      if (valid.has(group.homePassageTabId)) return group.homePassageTabId;
      const first = group.tabIds.find((id) => valid.has(id));
      if (first) return first;
    }
  }
  return null;
}

function removeSingleTab(
  state: StudyWorkspaceStateV2,
  tab: StudyWorkspaceTab,
  group: StudyWorkspaceGroup,
): StudyWorkspaceStateV2 {
  const index = group.tabIds.indexOf(tab.id);
  const removed = new Set([tab.id]);
  const fallback = fallbackTabIdAfterRemoval(state, group, index, removed);
  const tabsById = { ...state.tabsById };
  delete tabsById[tab.id];
  const tabIds = group.tabIds.filter((id) => id !== tab.id);
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...candidate,
          tabIds,
          lastActiveTabId: candidate.lastActiveTabId === tab.id
            ? (fallback ?? candidate.homePassageTabId)
            : candidate.lastActiveTabId,
        }
      : candidate),
    tabsById,
    activeTabId: state.activeTabId === tab.id ? (fallback ?? state.activeTabId) : state.activeTabId,
    activationOrder: state.activationOrder.filter((id) => id !== tab.id),
    recentlyClosed: appendRecentlyClosedItems(
      state.recentlyClosed,
      [{ kind: "tab", tab, index }],
    ),
  };
  return state.activeTabId === tab.id && fallback
    ? activateStudyWorkspaceTab(next, fallback)
    : next;
}

function dependentEntityTabIds(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
  passageTabId: string,
): string[] {
  return group.tabIds.filter((tabId) => {
    const tab = state.tabsById[tabId];
    return tab?.kind === "entity" && tab.returnPassageTabId === passageTabId;
  });
}

function localReturnPassageTabId(
  tabsById: Readonly<Record<string, StudyWorkspaceTab>>,
  group: StudyWorkspaceGroup,
  candidateId: string | null,
  origin: PassageViewState,
): string | null {
  if (!candidateId || !group.tabIds.includes(candidateId)) return null;
  const candidate = tabsById[candidateId];
  return candidate?.kind === "passage"
    && candidate.groupId === group.id
    && passageMatchesView(candidate, origin)
    ? candidate.id
    : null;
}

function recoverableReturnPassageTabId(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
  candidateId: string | null,
  origin: PassageViewState,
): string | null {
  const local = localReturnPassageTabId(state.tabsById, group, candidateId, origin);
  if (local || !candidateId || state.tabsById[candidateId]) return local;
  const pending = state.recentlyClosed.some((item) => (
    item.kind === "tab"
    && item.tab.kind === "passage"
    && item.tab.id === candidateId
    && item.tab.groupId === group.id
    && passageMatchesView(item.tab, origin)
  ));
  return pending ? candidateId : null;
}

function entityNonceSnapshots(
  state: StudyWorkspaceStateV2,
  tabIds: readonly string[],
): EntityWorkspaceNonceSnapshot[] {
  return tabIds.flatMap((tabId) => {
    const tab = state.tabsById[tabId];
    return tab?.kind === "entity" ? [{ tabId, nonce: tab.nonce }] : [];
  });
}

function matchesEntityNonceSnapshots(
  state: StudyWorkspaceStateV2,
  tabIds: readonly string[],
  expected: readonly EntityWorkspaceNonceSnapshot[] | undefined,
): boolean {
  if (!Array.isArray(expected)) return false;
  const current = entityNonceSnapshots(state, tabIds);
  return current.length === expected.length
    && current.every((snapshot, index) => (
      snapshot.tabId === expected[index]?.tabId
      && snapshot.nonce === expected[index]?.nonce
    ));
}

function nearestRemainingPassageId(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
  removed: ReadonlySet<string>,
  fromIndex: number,
): string | null {
  for (let distance = 1; distance < group.tabIds.length; distance += 1) {
    for (const index of [fromIndex + distance, fromIndex - distance]) {
      const tabId = group.tabIds[index];
      const tab = tabId ? state.tabsById[tabId] : undefined;
      if (tab?.kind === "passage" && !removed.has(tab.id)) return tab.id;
    }
  }
  return null;
}

function removeTabsFromGroup(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
  tabIds: readonly string[],
): StudyWorkspaceStateV2 {
  const removed = new Set(tabIds);
  const firstIndex = Math.min(...tabIds.map((tabId) => group.tabIds.indexOf(tabId)));
  const fallback = fallbackTabIdAfterRemoval(state, group, firstIndex, removed);
  const remainingTabIds = group.tabIds.filter((tabId) => !removed.has(tabId));
  const tabsById = { ...state.tabsById };
  const snapshots = tabIds.flatMap((tabId) => {
    const tab = state.tabsById[tabId];
    const index = group.tabIds.indexOf(tabId);
    if (!tab || index < 0) return [];
    delete tabsById[tabId];
    return [{ kind: "tab" as const, tab, index }];
  });
  const homePassageTabId = removed.has(group.homePassageTabId)
    ? nearestRemainingPassageId(
        state,
        group,
        removed,
        group.tabIds.indexOf(group.homePassageTabId),
      )
    : group.homePassageTabId;
  if (!homePassageTabId) return state;
  const localFallback = remainingTabIds[firstIndex]
    ?? remainingTabIds[firstIndex - 1]
    ?? homePassageTabId;
  const recoverySnapshots = [...snapshots].sort((left, right) => right.index - left.index);
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...candidate,
          homePassageTabId,
          tabIds: remainingTabIds,
          lastActiveTabId: removed.has(candidate.lastActiveTabId)
            ? localFallback
            : candidate.lastActiveTabId,
        }
      : candidate),
    tabsById,
    activeTabId: removed.has(state.activeTabId) ? (fallback ?? state.activeTabId) : state.activeTabId,
    activationOrder: state.activationOrder.filter((tabId) => !removed.has(tabId)),
    recentlyClosed: appendRecentlyClosedItems(
      state.recentlyClosed,
      recoverySnapshots,
    ),
  };
  return removed.has(state.activeTabId) && fallback
    ? activateStudyWorkspaceTab(next, fallback)
    : next;
}

export function closeStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  tabId: string,
): WorkspaceMutationResult {
  const tab = state.tabsById[tabId];
  const group = tab
    ? state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !group) return { state, outcome: "unchanged" };
  if (tab.kind === "passage") {
    const globalPassageCount = Object.values(state.tabsById)
      .filter((candidate) => candidate.kind === "passage").length;
    if (globalPassageCount <= 1) return { state, outcome: "unchanged" };
    const groupPassageCount = group.tabIds.filter((candidateId) => (
      state.tabsById[candidateId]?.kind === "passage"
    )).length;
    if (groupPassageCount <= 1) {
      return {
        state,
        outcome: "needs-confirmation",
        confirmation: {
          kind: "sole-group-passage",
          groupId: group.id,
          tabId: tab.id,
          tabIds: [...group.tabIds],
          entityNonces: entityNonceSnapshots(state, group.tabIds),
        },
      };
    }
    const dependentEntityIds = dependentEntityTabIds(state, group, tab.id);
    if (dependentEntityIds.length > 0) {
      return {
        state,
        outcome: "needs-confirmation",
        confirmation: {
          kind: "passage-dependencies",
          tabId: tab.id,
          dependentEntityIds,
          entityNonces: entityNonceSnapshots(state, dependentEntityIds),
          sourceGroupId: group.id,
          sourceTabIds: [...group.tabIds],
        },
      };
    }
    return { state: removeTabsFromGroup(state, group, [tab.id]), outcome: "applied" };
  }
  return { state: removeSingleTab(state, tab, group), outcome: "applied" };
}

function removeStudyGroup(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
): StudyWorkspaceStateV2 {
  const index = state.groups.findIndex((candidate) => candidate.id === group.id);
  const removed = new Set(group.tabIds);
  const fallback = fallbackTabIdAfterRemoval(state, group, 0, removed);
  const tabsById = { ...state.tabsById };
  const snapshotTabsById: Record<string, StudyWorkspaceTab> = {};
  for (const tabId of group.tabIds) {
    const tab = state.tabsById[tabId];
    if (tab) snapshotTabsById[tabId] = tab;
    delete tabsById[tabId];
  }
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups: state.groups.filter((candidate) => candidate.id !== group.id),
    tabsById,
    activeTabId: removed.has(state.activeTabId) ? (fallback ?? state.activeTabId) : state.activeTabId,
    activationOrder: state.activationOrder.filter((tabId) => !removed.has(tabId)),
    recentlyClosed: appendRecentlyClosedItems(
      state.recentlyClosed,
      [{ kind: "group", group, tabsById: snapshotTabsById, index }],
    ),
  };
  return removed.has(state.activeTabId) && fallback
    ? activateStudyWorkspaceTab(next, fallback)
    : next;
}

export function closeStudyWorkspaceGroup(
  state: StudyWorkspaceStateV2,
  groupId: string,
): WorkspaceMutationResult {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group || state.groups.length <= 1) return { state, outcome: "unchanged" };
  const globalPassageCount = Object.values(state.tabsById)
    .filter((tab) => tab.kind === "passage").length;
  const groupPassageCount = group.tabIds
    .filter((tabId) => state.tabsById[tabId]?.kind === "passage").length;
  if (globalPassageCount - groupPassageCount < 1) return { state, outcome: "unchanged" };
  if (group.tabIds.length > 1) {
    return {
      state,
      outcome: "needs-confirmation",
      confirmation: {
        kind: "close-study",
        groupId: group.id,
        tabIds: [...group.tabIds],
        entityNonces: entityNonceSnapshots(state, group.tabIds),
      },
    };
  }
  return { state: removeStudyGroup(state, group), outcome: "applied" };
}

export function studyWorkspaceTabCloseAvailability(
  state: StudyWorkspaceStateV2,
  tabId: string,
): WorkspaceCloseAvailability {
  const tab = state.tabsById[tabId];
  const group = tab
    ? state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !group) return "unavailable";
  if (tab.kind === "entity") return "direct";
  const globalPassageCount = Object.values(state.tabsById)
    .filter((candidate) => candidate.kind === "passage").length;
  if (globalPassageCount <= 1) return "unavailable";
  const groupPassageCount = group.tabIds.filter((candidateId) => (
    state.tabsById[candidateId]?.kind === "passage"
  )).length;
  if (groupPassageCount <= 1) return "decision";
  return dependentEntityTabIds(state, group, tab.id).length > 0 ? "decision" : "direct";
}

export function studyWorkspaceGroupCloseAvailability(
  state: StudyWorkspaceStateV2,
  groupId: string,
): WorkspaceCloseAvailability {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group || state.groups.length <= 1) return "unavailable";
  const globalPassageCount = Object.values(state.tabsById)
    .filter((tab) => tab.kind === "passage").length;
  const groupPassageCount = group.tabIds
    .filter((tabId) => state.tabsById[tabId]?.kind === "passage").length;
  if (globalPassageCount - groupPassageCount < 1) return "unavailable";
  return group.tabIds.length > 1 ? "decision" : "direct";
}

export function resolveStudyWorkspaceDecision(
  state: StudyWorkspaceStateV2,
  confirmation: WorkspaceConfirmation,
  decision: WorkspaceDecision,
): WorkspaceMutationResult {
  if (decision === "cancel" || decision === "keep-open") {
    return { state, outcome: "unchanged" };
  }
  if (confirmation.kind === "sole-group-passage") {
    if (decision !== "close-study") return { state, outcome: "unchanged" };
    const group = state.groups.find((candidate) => candidate.id === confirmation.groupId);
    const tab = state.tabsById[confirmation.tabId];
    const passages = group?.tabIds.filter((tabId) => state.tabsById[tabId]?.kind === "passage") ?? [];
    const globalPassageCount = Object.values(state.tabsById)
      .filter((candidate) => candidate.kind === "passage").length;
    if (!group || tab?.kind !== "passage" || tab.groupId !== group.id
      || group.tabIds.length !== confirmation.tabIds.length
      || group.tabIds.some((id, index) => id !== confirmation.tabIds[index])
      || !matchesEntityNonceSnapshots(state, group.tabIds, confirmation.entityNonces)
      || passages.length !== 1 || passages[0] !== tab.id || globalPassageCount <= 1) {
      return { state, outcome: "unchanged" };
    }
    return { state: removeStudyGroup(state, group), outcome: "applied" };
  }
  if (confirmation.kind === "close-study") {
    if (decision !== "close-study") return { state, outcome: "unchanged" };
    const group = state.groups.find((candidate) => candidate.id === confirmation.groupId);
    if (!group || group.tabIds.length <= 1
      || group.tabIds.length !== confirmation.tabIds.length
      || group.tabIds.some((id, index) => id !== confirmation.tabIds[index])
      || !matchesEntityNonceSnapshots(state, group.tabIds, confirmation.entityNonces)) {
      return { state, outcome: "unchanged" };
    }
    const globalPassageCount = Object.values(state.tabsById)
      .filter((candidate) => candidate.kind === "passage").length;
    const groupPassageCount = group.tabIds
      .filter((id) => state.tabsById[id]?.kind === "passage").length;
    if (state.groups.length <= 1 || globalPassageCount - groupPassageCount < 1) {
      return { state, outcome: "unchanged" };
    }
    return { state: removeStudyGroup(state, group), outcome: "applied" };
  }
  if (confirmation.kind === "move-branch") {
    if (decision !== "move-branch") return { state, outcome: "unchanged" };
    const tab = state.tabsById[confirmation.tabId];
    const sourceGroup = tab?.kind === "passage"
      ? state.groups.find((candidate) => candidate.id === tab.groupId
        && candidate.tabIds.includes(tab.id))
      : undefined;
    const targetGroup = state.groups.find((candidate) => candidate.id === confirmation.targetGroupId);
    if (!tab || !sourceGroup || sourceGroup.id !== confirmation.sourceGroupId
      || sourceGroup.tabIds.length !== confirmation.sourceTabIds.length
      || sourceGroup.tabIds.some((id, index) => id !== confirmation.sourceTabIds[index])
      || !targetGroup || sourceGroup.id === targetGroup.id
      || sourceGroup.homePassageTabId === tab.id) {
      return { state, outcome: "unchanged" };
    }
    const dependents = dependentEntityTabIds(state, sourceGroup, tab.id);
    if (dependents.length === 0
      || dependents.length !== confirmation.dependentEntityIds.length
      || dependents.some((id, index) => id !== confirmation.dependentEntityIds[index])
      || !matchesEntityNonceSnapshots(state, dependents, confirmation.entityNonces)) {
      return { state, outcome: "unchanged" };
    }
    return {
      state: moveTabRecords(state, [tab.id, ...dependents], sourceGroup, targetGroup, confirmation.slot),
      outcome: "applied",
    };
  }
  if (confirmation.kind === "move-entity-context") {
    if (decision !== "copy-origin-passage") return { state, outcome: "unchanged" };
    const tab = state.tabsById[confirmation.tabId];
    if (tab?.kind !== "entity") return { state, outcome: "unchanged" };
    const sourceGroup = state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id));
    const targetGroup = state.groups.find((candidate) => candidate.id === confirmation.targetGroupId);
    if (!sourceGroup || sourceGroup.id !== confirmation.sourceGroupId
      || tab.nonce !== confirmation.nonce
      || !targetGroup || sourceGroup.id === targetGroup.id) {
      return { state, outcome: "unchanged" };
    }
    let contextTabId = targetGroup.tabIds.find((id) => {
      const candidate = state.tabsById[id];
      return candidate?.kind === "passage"
        && candidate.session.current.book === tab.origin.book
        && candidate.session.current.chapter === tab.origin.chapter
        && candidate.session.current.packageId === tab.origin.packageId;
    });
    let working = state;
    let destination = targetGroup;
    if (!contextTabId) {
      if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
        return { state, outcome: "tab-limit" };
      }
      contextTabId = availableDerivedTabId(working, `${tab.id}-origin`);
      const contextTab: PassageWorkspaceTab = {
        kind: "passage",
        id: contextTabId,
        groupId: targetGroup.id,
        session: {
          current: clonePassageViewState(tab.origin),
          history: createNavigationHistory<PassageViewState>(),
        },
      };
      destination = {
        ...freezeAutomaticGroupLabel(state, targetGroup),
        tabIds: [...targetGroup.tabIds, contextTab.id],
      };
      working = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === targetGroup.id
          ? destination
          : candidate),
        tabsById: { ...state.tabsById, [contextTab.id]: contextTab },
      };
    }
    const moved = moveTabRecords(working, [tab.id], sourceGroup, destination, confirmation.slot);
    const movedEntity = moved.tabsById[tab.id];
    if (movedEntity?.kind !== "entity") return { state, outcome: "unchanged" };
    return {
      state: {
        ...moved,
        tabsById: {
          ...moved.tabsById,
          [tab.id]: { ...movedEntity, returnPassageTabId: contextTabId },
        },
      },
      outcome: "applied",
    };
  }
  if (confirmation.kind === "move-home-passage") {
    const tab = state.tabsById[confirmation.tabId];
    const sourceGroup = state.groups.find((candidate) => candidate.id === confirmation.groupId);
    const targetGroup = state.groups.find((candidate) => candidate.id === confirmation.targetGroupId);
    if (tab?.kind !== "passage" || !sourceGroup || !targetGroup
      || tab.groupId !== sourceGroup.id || sourceGroup.id === targetGroup.id
      || sourceGroup.tabIds.length !== confirmation.sourceTabIds.length
      || sourceGroup.tabIds.some((id, index) => id !== confirmation.sourceTabIds[index])
      || !matchesEntityNonceSnapshots(state, sourceGroup.tabIds, confirmation.entityNonces)
      || sourceGroup.homePassageTabId !== tab.id) {
      return { state, outcome: "unchanged" };
    }
    if (decision === "duplicate-home") {
      if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
        return { state, outcome: "tab-limit" };
      }
      const duplicateId = availableDerivedTabId(state, `${tab.id}-home`);
      const duplicate: PassageWorkspaceTab = {
        ...tab,
        id: duplicateId,
        session: {
          current: clonePassageViewState(tab.session.current),
          history: {
            back: tab.session.history.back.map(clonePassageViewState),
            forward: tab.session.history.forward.map(clonePassageViewState),
          },
        },
      };
      const homeIndex = sourceGroup.tabIds.indexOf(tab.id);
      const updatedSource: StudyWorkspaceGroup = {
        ...freezeAutomaticGroupLabel(state, sourceGroup),
        homePassageTabId: duplicate.id,
        tabIds: [
          ...sourceGroup.tabIds.slice(0, homeIndex),
          duplicate.id,
          ...sourceGroup.tabIds.slice(homeIndex),
        ],
      };
      const working: StudyWorkspaceStateV2 = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === sourceGroup.id
          ? updatedSource
          : candidate),
        tabsById: { ...state.tabsById, [duplicate.id]: duplicate },
        activationOrder: [
          ...state.activationOrder.filter((id) => id !== state.activeTabId),
          duplicate.id,
          state.activeTabId,
        ],
      };
      const dependents = dependentEntityTabIds(state, sourceGroup, tab.id);
      return {
        state: moveTabRecords(
          working,
          [tab.id, ...dependents],
          updatedSource,
          targetGroup,
          confirmation.slot,
        ),
        outcome: "applied",
      };
    }
    if (decision !== "move-study") return { state, outcome: "unchanged" };
    const moving = new Set(sourceGroup.tabIds);
    const destination: StudyWorkspaceGroup = {
      ...freezeAutomaticGroupLabel(state, targetGroup),
      tabIds: [...targetGroup.tabIds, ...sourceGroup.tabIds],
      lastActiveTabId: moving.has(state.activeTabId)
        ? state.activeTabId
        : targetGroup.lastActiveTabId,
    };
    const tabsById = { ...state.tabsById };
    for (const tabId of sourceGroup.tabIds) {
      const movingTab = tabsById[tabId];
      if (movingTab) tabsById[tabId] = { ...movingTab, groupId: targetGroup.id };
    }
    return {
      state: {
        ...state,
        groups: state.groups.flatMap((candidate) => {
          if (candidate.id === sourceGroup.id) return [];
          return candidate.id === targetGroup.id ? [destination] : [candidate];
        }),
        tabsById,
      },
      outcome: "applied",
    };
  }
  if (confirmation.kind !== "passage-dependencies"
    || (decision !== "close-passage-and-research" && decision !== "keep-research")) {
    return { state, outcome: "unchanged" };
  }
  const tab = state.tabsById[confirmation.tabId];
  const group = tab?.kind === "passage"
    ? state.groups.find((candidate) => candidate.id === tab.groupId
      && candidate.tabIds.includes(tab.id))
    : undefined;
  if (!tab || !group) return { state, outcome: "unchanged" };
  if (group.id !== confirmation.sourceGroupId
    || group.tabIds.length !== confirmation.sourceTabIds.length
    || group.tabIds.some((id, index) => id !== confirmation.sourceTabIds[index])) {
    return { state, outcome: "unchanged" };
  }
  const dependents = dependentEntityTabIds(state, group, tab.id);
  if (dependents.length === 0
    || dependents.length !== confirmation.dependentEntityIds.length
    || dependents.some((id, index) => id !== confirmation.dependentEntityIds[index])
    || !matchesEntityNonceSnapshots(state, dependents, confirmation.entityNonces)) {
    return { state, outcome: "unchanged" };
  }
  if (decision === "keep-research") {
    const detached: StudyWorkspaceStateV2 = {
      ...state,
      tabsById: {
        ...state.tabsById,
        ...Object.fromEntries(dependents.map((id) => {
          const entity = state.tabsById[id];
          return entity?.kind === "entity"
            ? [id, { ...entity, returnPassageTabId: null } satisfies EntityWorkspaceTab]
            : [id, entity];
        })),
      },
    };
    const next = removeTabsFromGroup(detached, group, [tab.id]);
    return next === detached
      ? { state, outcome: "unchanged" }
      : { state: next, outcome: "applied" };
  }
  const next = removeTabsFromGroup(state, group, [tab.id, ...dependents]);
  return next === state
    ? { state, outcome: "unchanged" }
    : { state: next, outcome: "applied" };
}

/**
 * FORGET WHAT WAS CLOSED.
 *
 * The list is a safety net, and a net nobody can empty is a net that fills up
 * with things the reader has stopped meaning to recover — ten entries deep, all
 * of them survivors of a restart, none of them removable except by reopening
 * them, which is the opposite of what the reader wants when they are tidying.
 *
 * It also holds more than it looks like it does. Every retained entry keeps a
 * whole tab (or a whole study and its tabs) and RESERVES that tab's id against
 * reuse — see `reservedStudyWorkspaceTabIds`, which derives from this array. So
 * clearing is not only a tidy: it hands the ids back. Nothing else has to be
 * told, because nothing else keeps its own copy.
 *
 * Paired with `restoreRecentlyClosedStudyItems` because a sweep of the recovery
 * list is the one place an undo genuinely earns its keep — the reader is
 * throwing away the very thing they would reach for if they were wrong.
 */
export function clearRecentlyClosedStudyItems(
  state: StudyWorkspaceStateV2,
): WorkspaceMutationResult {
  if (state.recentlyClosed.length === 0) return { state, outcome: "unchanged" };
  return { state: { ...state, recentlyClosed: [] }, outcome: "applied" };
}

/**
 * Put a cleared list back, exactly as it was.
 *
 * The items are not revalidated here and that is deliberate: they came out of
 * this same state moments ago, they are cloned on the way in as everything else
 * in this file is, and the cap is re-applied because a restore is not a licence
 * to exceed it. The persistence layer normalises on the way to disk regardless,
 * so a malformed entry could not survive a save even if one arrived.
 *
 * It refuses when the list is no longer empty: something has been closed since,
 * and pasting the old list over it would be an undo that discards a newer fact.
 */
export function restoreRecentlyClosedStudyItems(
  state: StudyWorkspaceStateV2,
  items: readonly ClosedStudyItem[],
): WorkspaceMutationResult {
  if (items.length === 0 || state.recentlyClosed.length > 0) {
    return { state, outcome: "unchanged" };
  }
  return {
    state: {
      ...state,
      recentlyClosed: items.slice(-RECENTLY_CLOSED_STUDY_LIMIT).map(cloneClosedStudyItem),
    },
    outcome: "applied",
  };
}

export function reopenClosedStudyItem(
  state: StudyWorkspaceStateV2,
): WorkspaceMutationResult {
  return reopenClosedStudyItemAt(state, state.recentlyClosed.length - 1);
}

/**
 * Reopen a specific retained recently-closed entry by its index in
 * `recentlyClosed` (oldest first). The strip-level recovery button always
 * reopens the most recent (last index); the All Tabs list can target any
 * retained item. Index bounds are validated so a stale index is a no-op.
 */
export function reopenClosedStudyItemAt(
  state: StudyWorkspaceStateV2,
  index: number,
): WorkspaceMutationResult {
  if (!Number.isInteger(index) || index < 0 || index >= state.recentlyClosed.length) {
    return { state, outcome: "unchanged" };
  }
  const storedItem = state.recentlyClosed[index];
  if (!storedItem) return { state, outcome: "unchanged" };
  const item = cloneClosedStudyItem(storedItem);
  const remainingRecentlyClosed = [
    ...state.recentlyClosed.slice(0, index),
    ...state.recentlyClosed.slice(index + 1),
  ].map(cloneClosedStudyItem);
  if (item.kind === "tab") {
    if (state.tabsById[item.tab.id]) return { state, outcome: "unchanged" };
    if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
      return { state, outcome: "tab-limit" };
    }
    const group = state.groups.find((candidate) => candidate.id === item.tab.groupId);
    if (!group) return { state, outcome: "unchanged" };
    const normalizedTab = normalizeStudyWorkspaceTab(item.tab);
    const restoredTab: StudyWorkspaceTab = normalizedTab.kind === "entity"
      ? {
          ...normalizedTab,
          returnPassageTabId: recoverableReturnPassageTabId(
            state,
            group,
            normalizedTab.returnPassageTabId,
            normalizedTab.origin,
          ),
        }
      : normalizedTab;
    const insertIndex = Math.max(0, Math.min(item.index, group.tabIds.length));
    const next: StudyWorkspaceStateV2 = {
      ...state,
      groups: state.groups.map((candidate) => candidate.id === group.id
        ? {
            ...candidate,
            tabIds: [
              ...candidate.tabIds.slice(0, insertIndex),
              item.tab.id,
              ...candidate.tabIds.slice(insertIndex),
            ],
          }
        : candidate),
      tabsById: { ...state.tabsById, [restoredTab.id]: restoredTab },
      recentlyClosed: remainingRecentlyClosed,
    };
    return {
      state: activateStudyWorkspaceTab(next, item.tab.id),
      outcome: "opened",
    };
  }
  if (state.groups.some((group) => group.id === item.group.id)
    || item.group.tabIds.some((tabId) => state.tabsById[tabId] || !item.tabsById[tabId])) {
    return { state, outcome: "unchanged" };
  }
  if (state.groups.length >= STUDY_WORKSPACE_GROUP_LIMIT) {
    return { state, outcome: "group-limit" };
  }
  if (Object.keys(state.tabsById).length + item.group.tabIds.length > STUDY_WORKSPACE_TAB_LIMIT) {
    return { state, outcome: "tab-limit" };
  }
  const groupIndex = Math.max(0, Math.min(item.index, state.groups.length));
  const normalizedTabsById: Record<string, StudyWorkspaceTab> = {};
  for (const [tabId, tab] of Object.entries(item.tabsById)) {
    normalizedTabsById[tabId] = normalizeStudyWorkspaceTab(tab);
  }
  const restoredTabsById: Record<string, StudyWorkspaceTab> = {};
  for (const [tabId, tab] of Object.entries(normalizedTabsById)) {
    restoredTabsById[tabId] = tab.kind === "entity"
      ? {
          ...tab,
          returnPassageTabId: localReturnPassageTabId(
            normalizedTabsById,
            item.group,
            tab.returnPassageTabId,
            tab.origin,
          ),
        }
      : tab;
  }
  const restoredActive = item.group.tabIds.includes(item.group.lastActiveTabId)
    ? item.group.lastActiveTabId
    : item.group.homePassageTabId;
  const groups = [...state.groups];
  groups.splice(groupIndex, 0, item.group);
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups,
    tabsById: { ...state.tabsById, ...restoredTabsById },
    activationOrder: [
      ...state.activationOrder,
      ...item.group.tabIds.filter((tabId) => tabId !== restoredActive),
    ],
    recentlyClosed: remainingRecentlyClosed,
  };
  return {
    state: activateStudyWorkspaceTab(next, restoredActive),
    outcome: "opened",
  };
}

export function openEntityWorkspaceTab(
  state: StudyWorkspaceStateV2,
  input: OpenEntityWorkspaceInput,
): WorkspaceMutationResult {
  const source = state.tabsById[input.sourceTabId];
  const group = source
    ? state.groups.find((candidate) => candidate.id === source.groupId
      && candidate.tabIds.includes(source.id))
    : undefined;
  if (!source || !group) {
    return { state, outcome: "unchanged" };
  }
  if (!input.duplicate) {
    const existingId = group.tabIds.find((tabId) => {
      const tab = state.tabsById[tabId];
      return tab?.kind === "entity"
        && tab.entityId === input.entityId
        && tab.origin.book === input.origin.book
        && tab.origin.chapter === input.origin.chapter
        && tab.origin.packageId === input.origin.packageId
        && tab.originRange?.start === input.originRange?.start
        && tab.originRange?.end === input.originRange?.end;
    });
    if (existingId) {
      return {
        state: activateStudyWorkspaceTab(state, existingId),
        outcome: "focused",
      };
    }
  }
  if (state.tabsById[input.id]) return { state, outcome: "unchanged" };
  if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
    return { state, outcome: "tab-limit" };
  }
  const origin = clonePassageViewState(input.origin);
  const tab: EntityWorkspaceTab = {
    kind: "entity",
    id: input.id,
    groupId: group.id,
    entityId: input.entityId,
    entityKind: input.entityKind,
    origin,
    ...(input.originRange ? { originRange: { ...input.originRange } } : {}),
    canvas: {
      current: clonePassageViewState(input.origin),
      history: createNavigationHistory<PassageViewState>(),
    },
    returnPassageTabId: localReturnPassageTabId(
      state.tabsById,
      group,
      input.returnPassageTabId,
      input.origin,
    ),
    trail: [{
      id: input.entityId,
      displayName: input.displayName?.trim() || input.entityId,
      kind: input.entityKind,
    }],
    scrollTop: 0,
    nonce: input.nonce,
  };
  const sourceIndex = group.tabIds.indexOf(source.id);
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...freezeAutomaticGroupLabel(state, candidate),
          tabIds: [
            ...candidate.tabIds.slice(0, sourceIndex + 1),
            tab.id,
            ...candidate.tabIds.slice(sourceIndex + 1),
          ],
        }
      : candidate),
    tabsById: { ...state.tabsById, [tab.id]: tab },
  };
  return { state: activateStudyWorkspaceTab(next, tab.id), outcome: "opened" };
}

export function branchEntityWorkspaceTab(
  state: StudyWorkspaceStateV2,
  input: BranchEntityWorkspaceInput,
): WorkspaceMutationResult {
  const source = state.tabsById[input.sourceTabId];
  const group = source?.kind === "entity"
    ? state.groups.find((candidate) => candidate.id === source.groupId
      && candidate.tabIds.includes(source.id))
    : undefined;
  if (!source || source.kind !== "entity" || !group || state.tabsById[input.id]) {
    return { state, outcome: "unchanged" };
  }
  if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
    return { state, outcome: "tab-limit" };
  }

  const tab: EntityWorkspaceTab = {
    kind: "entity",
    id: input.id,
    groupId: group.id,
    entityId: input.entry.id,
    entityKind: input.entry.kind ?? source.entityKind,
    origin: clonePassageViewState(source.origin),
    ...(source.originRange ? { originRange: { ...source.originRange } } : {}),
    canvas: clonePassageWorkspaceSession(source.canvas),
    returnPassageTabId: source.returnPassageTabId,
    trail: appendEntityResearchTrail(source.trail, input.entry),
    scrollTop: 0,
    nonce: input.nonce,
  };
  const sourceIndex = group.tabIds.indexOf(source.id);
  const next: StudyWorkspaceStateV2 = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...freezeAutomaticGroupLabel(state, candidate),
          tabIds: [
            ...candidate.tabIds.slice(0, sourceIndex + 1),
            tab.id,
            ...candidate.tabIds.slice(sourceIndex + 1),
          ],
        }
      : candidate),
    tabsById: { ...state.tabsById, [tab.id]: tab },
  };
  return { state: activateStudyWorkspaceTab(next, tab.id), outcome: "opened" };
}

export function returnEntityWorkspaceToOrigin(
  state: StudyWorkspaceStateV2,
  input: ReturnEntityWorkspaceToOriginInput,
): WorkspaceMutationResult {
  const entity = state.tabsById[input.entityTabId];
  const group = entity?.kind === "entity"
    ? state.groups.find((candidate) => candidate.id === entity.groupId
      && candidate.tabIds.includes(entity.id))
    : undefined;
  if (!entity || entity.kind !== "entity" || !group) {
    return { state, outcome: "unchanged" };
  }

  const canonicalReturnId = localReturnPassageTabId(
    state.tabsById,
    group,
    entity.returnPassageTabId,
    entity.origin,
  );
  const matchingPassageId = canonicalReturnId ?? group.tabIds.find((tabId) => {
    const candidate = state.tabsById[tabId];
    return candidate !== undefined && passageMatchesView(candidate, entity.origin);
  });

  let result: OpenPassageWorkspaceResult;
  if (matchingPassageId) {
    const repositioned = updateStudyCanvasSession(state, matchingPassageId, (session) => ({
      current: clonePassageViewState(entity.origin),
      history: pushNavigationHistory(
        clonePassageWorkspaceSession(session).history,
        clonePassageViewState(session.current),
      ),
    }));
    result = {
      state: activateStudyWorkspaceTab(repositioned, matchingPassageId),
      outcome: "focused",
    };
  } else {
    if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
      return { state, outcome: "tab-limit" };
    }
    const preferredId = input.passageTabId?.trim();
    const baseId = preferredId
      || entity.returnPassageTabId
      || `${entity.id}-origin`;
    result = openPassageWorkspaceTab(state, {
      id: availableDerivedTabId(state, baseId),
      sourceTabId: entity.id,
      view: entity.origin,
      duplicate: true,
    });
  }

  if (result.outcome !== "opened" && result.outcome !== "focused") return result;
  const targetId = result.state.activeTabId;
  const currentEntity = result.state.tabsById[entity.id];
  if (currentEntity?.kind !== "entity") return { state, outcome: "unchanged" };
  if (currentEntity.returnPassageTabId === targetId) return result;
  return {
    ...result,
    state: {
      ...result.state,
      tabsById: {
        ...result.state.tabsById,
        [entity.id]: { ...currentEntity, returnPassageTabId: targetId },
      },
    },
  };
}

export function navigateEntityWorkspaceTab(
  state: StudyWorkspaceStateV2,
  tabId: string,
  entry: EntityResearchTrailEntry,
  nonce: number,
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (tab?.kind !== "entity") return state;
  const updated: EntityWorkspaceTab = {
    ...tab,
    entityId: entry.id,
    entityKind: entry.kind ?? tab.entityKind,
    trail: appendEntityResearchTrail(tab.trail, entry),
    nonce,
  };
  return {
    ...state,
    tabsById: { ...state.tabsById, [tabId]: updated },
  };
}

export function updateStudyCanvasSession(
  state: StudyWorkspaceStateV2,
  tabId: string,
  update: (current: PassageWorkspaceSession) => PassageWorkspaceSession,
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (!tab) return state;
  const current = tab.kind === "passage" ? tab.session : tab.canvas;
  const next = normalizePassageWorkspaceSession(update(current));
  if (next === current) return state;
  const updated: StudyWorkspaceTab = tab.kind === "passage"
    ? { ...tab, session: next }
    : { ...tab, canvas: next };
  return {
    ...state,
    tabsById: { ...state.tabsById, [tabId]: updated },
  };
}

/**
 * Publish live canvas state only for the tab that still owns the rendered
 * canvas. Delayed scroll/selection work from a previously active tab must not
 * be allowed to write into either that inactive tab or the new active owner.
 */
export function updateActiveStudyCanvasSession(
  state: StudyWorkspaceStateV2,
  ownerTabId: string,
  update: (current: PassageWorkspaceSession) => PassageWorkspaceSession,
): StudyWorkspaceStateV2 {
  if (state.activeTabId !== ownerTabId) return state;
  return updateStudyCanvasSession(state, ownerTabId, update);
}

export function updateEntityWorkspaceScrollTop(
  state: StudyWorkspaceStateV2,
  tabId: string,
  scrollTop: number,
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (tab?.kind !== "entity" || !Number.isFinite(scrollTop) || scrollTop < 0) return state;
  if (tab.scrollTop === scrollTop) return state;
  return {
    ...state,
    tabsById: {
      ...state.tabsById,
      [tabId]: { ...tab, scrollTop },
    },
  };
}

export function updateEntityWorkspaceTrail(
  state: StudyWorkspaceStateV2,
  tabId: string,
  update: (
    current: readonly EntityResearchTrailEntry[],
  ) => readonly EntityResearchTrailEntry[],
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (tab?.kind !== "entity") return state;
  const requested = update(tab.trail.map(cloneEntityResearchTrailEntry));
  const trail = canonicalEntityResearchTrail(requested);
  const currentCheckpoint = trail.at(-1);
  const entityKind = currentCheckpoint?.id === tab.entityId && currentCheckpoint.kind
    ? currentCheckpoint.kind
    : tab.entityKind;
  if (entityKind === tab.entityKind && entityResearchTrailsEqual(tab.trail, trail)) return state;
  return {
    ...state,
    tabsById: {
      ...state.tabsById,
      [tabId]: { ...tab, entityKind, trail },
    },
  };
}

function passageMatchesView(tab: StudyWorkspaceTab, view: PassageViewState): boolean {
  if (tab.kind !== "passage") return false;
  const current = tab.session.current;
  return current.book === view.book
    && current.chapter === view.chapter
    && current.packageId === view.packageId;
}

export function openPassageWorkspaceTab(
  state: StudyWorkspaceStateV2,
  input: OpenPassageWorkspaceInput,
): OpenPassageWorkspaceResult {
  const source = state.tabsById[input.sourceTabId];
  const group = source
    ? state.groups.find((candidate) => candidate.id === source.groupId
      && candidate.tabIds.includes(source.id))
    : undefined;
  if (!source || !group) return { state, outcome: "unchanged" };

  if (!input.duplicate) {
    const existingId = group.tabIds.find((tabId) => {
      const tab = state.tabsById[tabId];
      return tab !== undefined && passageMatchesView(tab, input.view);
    });
    if (existingId) {
      const repositioned = updateStudyCanvasSession(state, existingId, (session) => ({
        current: clonePassageViewState(input.view),
        history: pushNavigationHistory(
          clonePassageWorkspaceSession(session).history,
          clonePassageViewState(session.current),
        ),
      }));
      return {
        state: activateStudyWorkspaceTab(repositioned, existingId),
        outcome: "focused",
      };
    }
  }

  if (state.tabsById[input.id]) return { state, outcome: "unchanged" };
  if (Object.keys(state.tabsById).length >= STUDY_WORKSPACE_TAB_LIMIT) {
    return { state, outcome: "tab-limit" };
  }
  const sourceIndex = group.tabIds.indexOf(source.id);
  const tab: PassageWorkspaceTab = {
    kind: "passage",
    id: input.id,
    groupId: group.id,
    session: {
      current: clonePassageViewState(input.view),
      history: createNavigationHistory<PassageViewState>(),
    },
  };
  const next = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...freezeAutomaticGroupLabel(state, candidate),
          tabIds: [
            ...candidate.tabIds.slice(0, sourceIndex + 1),
            tab.id,
            ...candidate.tabIds.slice(sourceIndex + 1),
          ],
        }
      : candidate),
    tabsById: { ...state.tabsById, [tab.id]: tab },
  };
  return {
    state: activateStudyWorkspaceTab(next, tab.id),
    outcome: "opened",
  };
}

export function activeStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
): StudyWorkspaceTab | null {
  return state.tabsById[state.activeTabId] ?? null;
}

export function activeStudyWorkspaceSession(
  state: StudyWorkspaceStateV2,
): PassageWorkspaceSession | null {
  const tab = activeStudyWorkspaceTab(state);
  if (!tab) return null;
  return tab.kind === "passage" ? tab.session : tab.canvas;
}

export function orderedStudyWorkspaceGroups(
  state: StudyWorkspaceStateV2,
): readonly StudyWorkspaceGroup[] {
  return state.groups;
}

export function orderedStudyWorkspaceTabs(
  state: StudyWorkspaceStateV2,
  groupId: string,
): StudyWorkspaceTab[] {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return group.tabIds.flatMap((tabId) => {
    const tab = state.tabsById[tabId];
    return tab ? [tab] : [];
  });
}

/**
 * Every collapsed study retains one real tab as its APG proxy. The selected
 * tab wins for its own group; inactive groups retain their last active tab so
 * collapsing never makes an entire study unreachable from the strip.
 */
export function visibleStudyWorkspaceTabIds(
  state: StudyWorkspaceStateV2,
): string[] {
  return state.groups.flatMap((group) => {
    const validTabIds = group.tabIds.filter((tabId) => state.tabsById[tabId]?.groupId === group.id);
    if (!group.collapsed) return validTabIds;
    const selected = validTabIds.includes(state.activeTabId) ? state.activeTabId : null;
    const retained = validTabIds.includes(group.lastActiveTabId) ? group.lastActiveTabId : null;
    const proxy = selected ?? retained ?? (
      validTabIds.includes(group.homePassageTabId) ? group.homePassageTabId : validTabIds[0]
    );
    return proxy ? [proxy] : [];
  });
}

/**
 * Every tab in the register, in register order, INCLUDING the members of
 * collapsed studies.
 *
 * This is deliberately not `visibleStudyWorkspaceTabIds`: that list drops a
 * collapsed study to its single APG proxy, which is right for roving focus and
 * wrong for ordinals. ⌘1–9 counts across the whole register so the number under
 * a tab never changes because a group folded — a shortcut that renumbers itself
 * when you collapse a study is a shortcut you stop trusting.
 */
export function studyWorkspaceRegisterTabIds(
  state: StudyWorkspaceStateV2,
): string[] {
  return state.groups.flatMap((group) => group.tabIds.filter(
    (tabId) => state.tabsById[tabId]?.groupId === group.id,
  ));
}

/**
 * The tabs the strip shows: the active study's, in its own order.
 *
 * THE REGISTER IS ONE STUDY AT A TIME as of 2026-07-30. The study line above
 * the strip names every study and the strip holds exactly the one the page is
 * in, so "the register" and "the workspace" are no longer the same list, and
 * everything that walks the register — Ctrl+Tab, ⌘1–9, the strip's arrows —
 * walks this one.
 *
 * Deliberately blind to `collapsed`. That field is still in the model and still
 * persisted, and nothing reads it any more: folding a study was a way of
 * getting its tabs out of the row, and the row now holds one study's tabs by
 * construction.
 */
export function studyWorkspaceStripTabIds(
  state: StudyWorkspaceStateV2,
): string[] {
  const groupId = state.tabsById[state.activeTabId]?.groupId;
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return group.tabIds.filter((tabId) => state.tabsById[tabId]?.groupId === group.id);
}

/** How many register ordinals the keyboard exposes: ⌘1 … ⌘9. */
export const STUDY_WORKSPACE_ORDINAL_LIMIT = 9;

/**
 * The tab a 1-based register ordinal addresses, or `null` when the strip is
 * shorter than the ordinal. Only the first nine are addressable; a tenth
 * shortcut is a shortcut nobody counts to.
 *
 * It counted across the whole workspace until 2026-07-30, so that folding a
 * study could not silently renumber every shortcut after it. Nothing folds now,
 * and the reason the count was global has gone with it: ⌘4 addresses the fourth
 * tab of the study you are reading, which is the only run of tabs on screen.
 */
export function studyWorkspaceOrdinalTabId(
  state: StudyWorkspaceStateV2,
  ordinal: number,
): string | null {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > STUDY_WORKSPACE_ORDINAL_LIMIT) {
    return null;
  }
  return studyWorkspaceStripTabIds(state)[ordinal - 1] ?? null;
}

/**
 * The ordinal shown beside a tab in the All Tabs overview, or `null` when the
 * tab is past ⌘9 or belongs to a study the page is not in. Numbers appear in
 * that list and never on the tabs themselves — a strip of shortcut hints is
 * chrome about chrome.
 */
export function studyWorkspaceTabOrdinal(
  state: StudyWorkspaceStateV2,
  tabId: string,
): number | null {
  const index = studyWorkspaceStripTabIds(state).indexOf(tabId);
  if (index < 0 || index >= STUDY_WORKSPACE_ORDINAL_LIMIT) return null;
  return index + 1;
}

function referenceLabel(
  reference: { book: string; chapter: number },
  bookNames?: StudyWorkspaceBookNames,
): string {
  const book = bookNames?.[reference.book]?.[0] ?? reference.book;
  return `${book} ${reference.chapter}`;
}

export function studyWorkspaceGroupLabel(
  state: StudyWorkspaceStateV2,
  group: StudyWorkspaceGroup,
  bookNames?: StudyWorkspaceBookNames,
): string {
  if (group.label.kind === "custom") return group.label.value;
  if (group.label.frozenReference) return referenceLabel(group.label.frozenReference, bookNames);
  const home = state.tabsById[group.homePassageTabId];
  return home?.kind === "passage"
    ? referenceLabel(home.session.current, bookNames)
    : group.id;
}

export function studyWorkspaceTranslationCollisionTabIds(
  state: StudyWorkspaceStateV2,
): string[] {
  return state.groups.flatMap((group) => {
    const tabs = orderedStudyWorkspaceTabs(state, group.id);
    return tabs.flatMap((tab) => {
      if (tab.kind !== "passage") return [];
      const current = tab.session.current;
      const collision = tabs.some((candidate) => candidate.kind === "passage"
        && candidate.id !== tab.id
        && candidate.session.current.book === current.book
        && candidate.session.current.chapter === current.chapter
        && candidate.session.current.packageId !== current.packageId);
      return collision ? [tab.id] : [];
    });
  });
}

export function studyWorkspaceTabLabel(
  state: StudyWorkspaceStateV2,
  tab: StudyWorkspaceTab,
  bookNames?: StudyWorkspaceBookNames,
): string {
  if (tab.kind === "entity") return tab.trail.at(-1)?.displayName ?? tab.entityId;
  const reference = referenceLabel(tab.session.current, bookNames);
  return studyWorkspaceTranslationCollisionTabIds(state).includes(tab.id)
    ? `${reference} · ${tab.session.current.packageId}`
    : reference;
}

/**
 * The longest abbreviation the register prints: `1 THESS`. The table is fixed,
 * so this is a check on the table rather than a truncation — if a book has no
 * alias this short the label falls back to the shortest one it does have.
 */
const REGISTER_BOOK_ABBREVIATION_MAX = 7;

/**
 * Pick the register's fixed abbreviation for a book.
 *
 * Abbreviate only where abbreviating buys something: ACTS, MARK, LUKE and JOHN
 * are already as short as their abbreviations, and clipping them to ACT or JOH
 * makes the register harder to read for no width at all. Where the full name is
 * long, take the first alias that fits — `1 Thessalonians` → `1 THESS`,
 * `Philemon` → `PHLM`, and `Song of Solomon` → `SONG` rather than the
 * next alias in the table, `Song of Songs`, which is longer than a tab.
 */
function registerBookAbbreviation(
  names: readonly string[] | undefined,
  fallback: string,
): string {
  const full = names?.[0];
  if (!full) return fallback.toUpperCase();
  if (full.length <= 5) return full.toUpperCase();
  const fitted = names.find((name, index) => index > 0 && name.length <= REGISTER_BOOK_ABBREVIATION_MAX);
  if (fitted) return fitted.toUpperCase();
  const shortest = names.reduce((best, name) => (name.length < best.length ? name : best), full);
  return shortest.toUpperCase();
}

/**
 * A register tab is a chapter, and it says so in two voices: the book in mono
 * caps, the chapter in serif numerals. The abbreviation is a fixed string from
 * the book-name table (`1 THESS`, `PHLM`), never a truncation computed at
 * render time — a label that shortens itself stops being a name you can scan.
 */
export function studyWorkspaceTabLabelParts(
  state: StudyWorkspaceStateV2,
  tab: StudyWorkspaceTab,
  bookNames?: StudyWorkspaceBookNames,
): { book: string; chapter: string; qualifier?: string } | null {
  if (tab.kind !== "passage") return null;
  const reference = tab.session.current;
  return {
    book: registerBookAbbreviation(bookNames?.[reference.book], reference.book),
    chapter: String(reference.chapter),
    ...(studyWorkspaceTranslationCollisionTabIds(state).includes(tab.id)
      ? { qualifier: reference.packageId }
      : {}),
  };
}

export function studyWorkspaceTabType(
  tab: StudyWorkspaceTab,
): "passage" | EntityWorkspaceKind {
  if (tab.kind === "passage") return "passage";
  return tab.trail.at(-1)?.kind ?? tab.entityKind;
}
