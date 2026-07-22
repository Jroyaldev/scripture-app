import {
  createNavigationHistory,
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
  outcome: "opened" | "focused" | "unchanged";
}

export interface StudyWorkspaceBookNames {
  readonly [bookCode: string]: readonly string[] | undefined;
}

export const ENTITY_RESEARCH_TRAIL_LIMIT = 12;

export function appendEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  entry: EntityResearchTrailEntry,
): EntityResearchTrailEntry[] {
  const current = trail.at(-1);
  if (current?.id === entry.id) {
    const checkpoint = entry.kind === undefined && current.kind !== undefined
      ? { ...entry, kind: current.kind }
      : entry;
    const updated = current.displayName === checkpoint.displayName && current.kind === checkpoint.kind
      ? [...trail]
      : [...trail.slice(0, -1), checkpoint];
    return updated.slice(-ENTITY_RESEARCH_TRAIL_LIMIT);
  }
  return [...trail, entry].slice(-ENTITY_RESEARCH_TRAIL_LIMIT);
}

export function truncateEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  index: number,
): EntityResearchTrailEntry[] {
  if (index < 0 || index >= trail.length) return [...trail];
  return trail.slice(0, index + 1);
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
      current: initial,
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

export function selectStudyWorkspaceTab(
  state: StudyWorkspaceStateV2,
  tabId: string,
): StudyWorkspaceStateV2 {
  return activateStudyWorkspaceTab(state, tabId);
}

export function updateStudyCanvasSession(
  state: StudyWorkspaceStateV2,
  tabId: string,
  update: (current: PassageWorkspaceSession) => PassageWorkspaceSession,
): StudyWorkspaceStateV2 {
  const tab = state.tabsById[tabId];
  if (!tab) return state;
  const current = tab.kind === "passage" ? tab.session : tab.canvas;
  const next = update(current);
  if (next === current) return state;
  const updated: StudyWorkspaceTab = tab.kind === "passage"
    ? { ...tab, session: next }
    : { ...tab, canvas: next };
  return {
    ...state,
    tabsById: { ...state.tabsById, [tabId]: updated },
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
        current: input.view,
        history: pushNavigationHistory(session.history, session.current),
      }));
      return {
        state: activateStudyWorkspaceTab(repositioned, existingId),
        outcome: "focused",
      };
    }
  }

  if (state.tabsById[input.id]) return { state, outcome: "unchanged" };
  const sourceIndex = group.tabIds.indexOf(source.id);
  const tab: PassageWorkspaceTab = {
    kind: "passage",
    id: input.id,
    groupId: group.id,
    session: {
      current: input.view,
      history: createNavigationHistory<PassageViewState>(),
    },
  };
  const next = {
    ...state,
    groups: state.groups.map((candidate) => candidate.id === group.id
      ? {
          ...candidate,
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

export function studyWorkspaceTabType(
  tab: StudyWorkspaceTab,
): "passage" | EntityWorkspaceKind {
  if (tab.kind === "passage") return "passage";
  return tab.trail.at(-1)?.kind ?? tab.entityKind;
}
