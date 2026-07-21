import type { CommandReadingContext } from "../components/CommandPalette.js";
import type { EntityResearchTrailEntry } from "../components/LivingMargin.js";

export const SCRIPTURE_WORKSPACE_ID = "scripture";
export const MAX_RESEARCH_WORKSPACE_TABS = 64;

export interface ResearchWorkspaceTab {
  id: string;
  entityId: string;
  origin: CommandReadingContext;
  trail: EntityResearchTrailEntry[];
  nonce: number;
}

export interface ResearchWorkspaceState {
  tabs: ResearchWorkspaceTab[];
  activeTabId: string;
  lastResearchTabId: string | null;
  activationOrder: string[];
}

export interface OpenResearchWorkspaceTab {
  id: string;
  entityId: string;
  origin: CommandReadingContext;
  nonce: number;
}

export function createResearchWorkspaceState(): ResearchWorkspaceState {
  return {
    tabs: [],
    activeTabId: SCRIPTURE_WORKSPACE_ID,
    lastResearchTabId: null,
    activationOrder: [SCRIPTURE_WORKSPACE_ID],
  };
}

export function researchOriginGroupKey(origin: CommandReadingContext): string {
  return `${origin.book}:${origin.chapter}:${origin.packageId}`;
}

function activate(
  state: ResearchWorkspaceState,
  tabId: string,
): ResearchWorkspaceState {
  const valid = tabId === SCRIPTURE_WORKSPACE_ID || state.tabs.some((tab) => tab.id === tabId);
  if (!valid) return state;
  return {
    ...state,
    activeTabId: tabId,
    lastResearchTabId: tabId === SCRIPTURE_WORKSPACE_ID ? state.lastResearchTabId : tabId,
    activationOrder: [...state.activationOrder.filter((id) => id !== tabId), tabId],
  };
}

export function selectResearchWorkspaceTab(
  state: ResearchWorkspaceState,
  tabId: string,
): ResearchWorkspaceState {
  return activate(state, tabId);
}

export function openResearchWorkspaceTab(
  state: ResearchWorkspaceState,
  input: OpenResearchWorkspaceTab,
): ResearchWorkspaceState {
  const groupKey = researchOriginGroupKey(input.origin);
  const existing = state.tabs.find((tab) => (
    tab.entityId === input.entityId && researchOriginGroupKey(tab.origin) === groupKey
  ));
  if (existing) return activate(state, existing.id);
  const evictionId = state.tabs.length >= MAX_RESEARCH_WORKSPACE_TABS
    ? state.activationOrder.find((id) => (
        id !== SCRIPTURE_WORKSPACE_ID && state.tabs.some((tab) => tab.id === id)
      ))
      ?? state.tabs.find((tab) => tab.id !== state.activeTabId)?.id
      ?? state.tabs[0]?.id
    : undefined;
  const boundedState = evictionId
    ? removeResearchWorkspaceTabs(state, new Set([evictionId]))
    : state;
  return activate({
    ...boundedState,
    tabs: [...boundedState.tabs, {
      id: input.id,
      entityId: input.entityId,
      origin: input.origin,
      trail: [],
      nonce: input.nonce,
    }],
  }, input.id);
}

export function navigateActiveResearchWorkspaceTab(
  state: ResearchWorkspaceState,
  entityId: string,
  nonce: number,
): ResearchWorkspaceState {
  if (state.activeTabId === SCRIPTURE_WORKSPACE_ID) return state;
  const current = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!current) return state;
  const existing = state.tabs.find((tab) => (
    tab.id !== current.id
    && tab.entityId === entityId
    && researchOriginGroupKey(tab.origin) === researchOriginGroupKey(current.origin)
  ));
  if (existing) return activate(state, existing.id);
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === current.id ? { ...tab, entityId, nonce } : tab),
  };
}

export function updateResearchWorkspaceTrail(
  state: ResearchWorkspaceState,
  tabId: string,
  update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
): ResearchWorkspaceState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, trail: update(tab.trail) } : tab),
  };
}

function removeResearchWorkspaceTabs(
  state: ResearchWorkspaceState,
  removedIds: ReadonlySet<string>,
): ResearchWorkspaceState {
  const tabs = state.tabs.filter((tab) => !removedIds.has(tab.id));
  const remainingIds = new Set(tabs.map((tab) => tab.id));
  const activationOrder = state.activationOrder.filter((id) => (
    id === SCRIPTURE_WORKSPACE_ID || remainingIds.has(id)
  ));
  const activeWasRemoved = removedIds.has(state.activeTabId);
  const activeTabId = activeWasRemoved
    ? [...activationOrder].reverse().find((id) => id === SCRIPTURE_WORKSPACE_ID || remainingIds.has(id))
      ?? SCRIPTURE_WORKSPACE_ID
    : state.activeTabId;
  const lastResearchTabId = state.lastResearchTabId && remainingIds.has(state.lastResearchTabId)
    ? state.lastResearchTabId
    : [...activationOrder].reverse().find((id) => remainingIds.has(id)) ?? tabs.at(-1)?.id ?? null;
  return {
    tabs,
    activeTabId,
    lastResearchTabId,
    activationOrder: activationOrder.includes(activeTabId)
      ? activationOrder
      : [...activationOrder, activeTabId],
  };
}

export function closeResearchWorkspaceTab(
  state: ResearchWorkspaceState,
  tabId: string,
): ResearchWorkspaceState {
  return removeResearchWorkspaceTabs(state, new Set([tabId]));
}

export function closeResearchWorkspaceGroup(
  state: ResearchWorkspaceState,
  groupKey: string,
): ResearchWorkspaceState {
  const removedIds = new Set(
    state.tabs
      .filter((tab) => researchOriginGroupKey(tab.origin) === groupKey)
      .map((tab) => tab.id),
  );
  const next = removeResearchWorkspaceTabs(state, removedIds);
  return removedIds.has(state.activeTabId)
    ? activate(next, SCRIPTURE_WORKSPACE_ID)
    : next;
}

export function retainedResearchWorkspaceTab(
  state: ResearchWorkspaceState,
): ResearchWorkspaceTab | null {
  const targetId = state.activeTabId === SCRIPTURE_WORKSPACE_ID
    ? state.lastResearchTabId
    : state.activeTabId;
  return state.tabs.find((tab) => tab.id === targetId) ?? null;
}

export function researchWorkspaceTabLabel(tab: ResearchWorkspaceTab): string {
  return tab.trail.at(-1)?.displayName ?? "Research";
}
