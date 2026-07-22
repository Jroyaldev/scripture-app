const WORKSPACE_VERSION = 2 as const;
const GROUP_LIMIT = 16;
const TAB_LIMIT = 64;
const HISTORY_LIMIT = 50;
const TRAIL_LIMIT = 12;
const RECENT_LIMIT = 10;

type PersistedMarginTab = "overview" | "connections" | "passage" | "notes";
type PersistedEntityKind = "person" | "place" | "other";

export type PersistedMarginScope =
  | {
      kind: "kept";
      book: string;
      chapter: number;
      verse: number;
      endVerse?: number;
      label?: string;
    }
  | { kind: "selection"; start: number; end: number }
  | null;

export interface PersistedPassageViewState {
  book: string;
  chapter: number;
  packageId: string;
  verse?: number;
  verseOffset?: number;
  scrollTop?: number;
  selection?: {
    packageId: string;
    pieces: Array<{
      verse: number;
      charStart: number | null;
      charEnd: number | null;
    }>;
  };
  margin: {
    activeTab: PersistedMarginTab;
    scope: PersistedMarginScope;
    scrollTopByTab: Partial<Record<PersistedMarginTab, number>>;
    wordsVerse?: number;
    wordsFollowingReading: boolean;
  };
}

export interface PersistedPassageWorkspaceSession {
  current: PersistedPassageViewState;
  history: {
    back: PersistedPassageViewState[];
    forward: PersistedPassageViewState[];
  };
}

export interface PersistedPassageWorkspaceTab {
  kind: "passage";
  id: string;
  groupId: string;
  session: PersistedPassageWorkspaceSession;
}

export interface PersistedEntityWorkspaceTab {
  kind: "entity";
  id: string;
  groupId: string;
  entityId: string;
  entityKind: PersistedEntityKind;
  origin: PersistedPassageViewState;
  originRange?: { start: number; end: number };
  canvas: PersistedPassageWorkspaceSession;
  returnPassageTabId: string | null;
  trail: Array<{ id: string; displayName: string; kind?: PersistedEntityKind }>;
  scrollTop: number;
  nonce: number;
}

export type PersistedStudyWorkspaceTab =
  | PersistedPassageWorkspaceTab
  | PersistedEntityWorkspaceTab;

export interface PersistedStudyWorkspaceGroup {
  id: string;
  homePassageTabId: string;
  tabIds: string[];
  lastActiveTabId: string;
  collapsed: boolean;
  label:
    | { kind: "automatic"; frozenReference?: { book: string; chapter: number } }
    | { kind: "custom"; value: string };
}

export type PersistedClosedStudyItem =
  | { kind: "tab"; tab: PersistedStudyWorkspaceTab; index: number }
  | {
      kind: "group";
      group: PersistedStudyWorkspaceGroup;
      tabsById: Record<string, PersistedStudyWorkspaceTab>;
      index: number;
    };

export interface PersistedStudyWorkspaceV2 {
  version: 2;
  groups: PersistedStudyWorkspaceGroup[];
  tabsById: Record<string, PersistedStudyWorkspaceTab>;
  activeTabId: string;
  activationOrder: string[];
  recentlyClosed: PersistedClosedStudyItem[];
}

export type StudyWorkspaceValidation =
  | { ok: true; value: PersistedStudyWorkspaceV2 }
  | { ok: false; reason: "invalid" | "newer-version" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximum = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function identifier(value: unknown): string | null {
  return boundedString(value, 160);
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalPositiveInteger(
  source: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return positiveInteger(source[key]);
}

function optionalNonNegativeNumber(
  source: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return nonNegativeNumber(source[key]);
}

function optionalFiniteNumber(
  source: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return finiteNumber(source[key]);
}

function normalizeScope(value: unknown): PersistedMarginScope | undefined {
  if (value === null) return null;
  const scope = asRecord(value);
  if (!scope) return undefined;
  if (scope["kind"] === "selection") {
    const start = positiveInteger(scope["start"]);
    const end = positiveInteger(scope["end"]);
    if (start === null || end === null || end < start) return undefined;
    return { kind: "selection", start, end };
  }
  if (scope["kind"] !== "kept") return undefined;
  const book = boundedString(scope["book"], 3);
  const chapter = positiveInteger(scope["chapter"]);
  const verse = positiveInteger(scope["verse"]);
  if (!book || !/^[1-3A-Z]{3}$/.test(book) || chapter === null || verse === null) {
    return undefined;
  }
  const endVerse = optionalPositiveInteger(scope, "endVerse");
  if (endVerse === null || (endVerse !== undefined && endVerse < verse)) return undefined;
  const label = Object.prototype.hasOwnProperty.call(scope, "label")
    ? boundedString(scope["label"], 120)
    : undefined;
  if (label === null) return undefined;
  return {
    kind: "kept",
    book,
    chapter,
    verse,
    ...(endVerse !== undefined ? { endVerse } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

const MARGIN_TABS = new Set<PersistedMarginTab>([
  "overview",
  "connections",
  "passage",
  "notes",
]);

function normalizePassageView(value: unknown): PersistedPassageViewState | null {
  const source = asRecord(value);
  if (!source) return null;
  const book = boundedString(source["book"], 3);
  const chapter = positiveInteger(source["chapter"]);
  const packageId = boundedString(source["packageId"]);
  const margin = asRecord(source["margin"]);
  if (!book || !/^[1-3A-Z]{3}$/.test(book) || chapter === null || !packageId || !margin) {
    return null;
  }
  const activeTab = margin["activeTab"];
  const scope = normalizeScope(margin["scope"]);
  const rawScrolls = asRecord(margin["scrollTopByTab"]);
  if (typeof activeTab !== "string" || !MARGIN_TABS.has(activeTab as PersistedMarginTab)
    || scope === undefined || !rawScrolls || typeof margin["wordsFollowingReading"] !== "boolean") {
    return null;
  }
  const scrollTopByTab: Partial<Record<PersistedMarginTab, number>> = {};
  for (const tab of MARGIN_TABS) {
    if (!Object.prototype.hasOwnProperty.call(rawScrolls, tab)) continue;
    const scrollTop = nonNegativeNumber(rawScrolls[tab]);
    if (scrollTop === null) return null;
    scrollTopByTab[tab] = scrollTop;
  }
  const verse = optionalPositiveInteger(source, "verse");
  const verseOffset = optionalFiniteNumber(source, "verseOffset");
  const scrollTop = optionalNonNegativeNumber(source, "scrollTop");
  const wordsVerse = optionalPositiveInteger(margin, "wordsVerse");
  if (verse === null || verseOffset === null || scrollTop === null || wordsVerse === null) return null;

  let selection: PersistedPassageViewState["selection"];
  if (Object.prototype.hasOwnProperty.call(source, "selection")) {
    const rawSelection = asRecord(source["selection"]);
    const selectionPackageId = rawSelection ? boundedString(rawSelection["packageId"]) : null;
    if (!rawSelection || !selectionPackageId || !Array.isArray(rawSelection["pieces"])) return null;
    const pieces: NonNullable<PersistedPassageViewState["selection"]>["pieces"] = [];
    for (const rawPiece of rawSelection["pieces"]) {
      const piece = asRecord(rawPiece);
      const pieceVerse = piece ? positiveInteger(piece["verse"]) : null;
      if (!piece || pieceVerse === null) return null;
      const charStart = piece["charStart"] === null ? null : nonNegativeInteger(piece["charStart"]);
      const charEnd = piece["charEnd"] === null ? null : nonNegativeInteger(piece["charEnd"]);
      if (charStart === null && piece["charStart"] !== null) return null;
      if (charEnd === null && piece["charEnd"] !== null) return null;
      if ((charStart === null) !== (charEnd === null)
        || (charStart !== null && charEnd !== null && charEnd < charStart)) return null;
      pieces.push({ verse: pieceVerse, charStart, charEnd });
    }
    selection = { packageId: selectionPackageId, pieces };
  }

  return {
    book,
    chapter,
    packageId,
    ...(verse !== undefined ? { verse } : {}),
    ...(verseOffset !== undefined ? { verseOffset } : {}),
    ...(scrollTop !== undefined ? { scrollTop } : {}),
    ...(selection ? { selection } : {}),
    margin: {
      activeTab: activeTab as PersistedMarginTab,
      scope,
      scrollTopByTab,
      ...(wordsVerse !== undefined ? { wordsVerse } : {}),
      wordsFollowingReading: margin["wordsFollowingReading"],
    },
  };
}

function normalizeSession(value: unknown): PersistedPassageWorkspaceSession | null {
  const source = asRecord(value);
  const history = source ? asRecord(source["history"]) : null;
  if (!source || !history || !Array.isArray(history["back"]) || !Array.isArray(history["forward"])) {
    return null;
  }
  const current = normalizePassageView(source["current"]);
  if (!current) return null;
  const rawBack = history["back"];
  const rawForward = history["forward"];
  let backLength = 0;
  let forwardLength = 0;
  while (backLength + forwardLength < HISTORY_LIMIT
    && (backLength < rawBack.length || forwardLength < rawForward.length)) {
    if (backLength < rawBack.length) backLength += 1;
    if (backLength + forwardLength < HISTORY_LIMIT && forwardLength < rawForward.length) {
      forwardLength += 1;
    }
  }
  const back: PersistedPassageViewState[] = [];
  const forward: PersistedPassageViewState[] = [];
  for (const entry of rawBack.slice(-backLength)) {
    const normalized = normalizePassageView(entry);
    if (!normalized) return null;
    back.push(normalized);
  }
  for (const entry of rawForward.slice(0, forwardLength)) {
    const normalized = normalizePassageView(entry);
    if (!normalized) return null;
    forward.push(normalized);
  }
  return { current, history: { back, forward } };
}

function normalizePassageTab(
  value: unknown,
  canonicalId: string,
  canonicalGroupId: string,
): PersistedPassageWorkspaceTab | null {
  const source = asRecord(value);
  if (!source || source["kind"] !== "passage") return null;
  if (!identifier(source["id"]) || !identifier(source["groupId"])) return null;
  const session = normalizeSession(source["session"]);
  return session
    ? { kind: "passage", id: canonicalId, groupId: canonicalGroupId, session }
    : null;
}

function normalizeEntityKind(value: unknown): PersistedEntityKind | null {
  return value === "person" || value === "place" || value === "other" ? value : null;
}

function normalizeEntityTab(
  value: unknown,
  canonicalId: string,
  canonicalGroupId: string,
): PersistedEntityWorkspaceTab | null {
  const source = asRecord(value);
  if (!source || source["kind"] !== "entity") return null;
  const entityId = boundedString(source["entityId"]);
  const entityKind = normalizeEntityKind(source["entityKind"]);
  const origin = normalizePassageView(source["origin"]);
  const canvas = normalizeSession(source["canvas"]);
  const scrollTop = nonNegativeNumber(source["scrollTop"]);
  const nonce = nonNegativeInteger(source["nonce"]);
  if (!identifier(source["id"]) || !identifier(source["groupId"])
    || !entityId || !entityKind || !origin || !canvas
    || scrollTop === null || nonce === null || !Array.isArray(source["trail"])) {
    return null;
  }
  const returnPassageTabId = source["returnPassageTabId"] === null
    ? null
    : identifier(source["returnPassageTabId"]);
  if (returnPassageTabId === null && source["returnPassageTabId"] !== null) return null;

  let originRange: PersistedEntityWorkspaceTab["originRange"];
  if (Object.prototype.hasOwnProperty.call(source, "originRange")) {
    const range = asRecord(source["originRange"]);
    const start = range ? positiveInteger(range["start"]) : null;
    const end = range ? positiveInteger(range["end"]) : null;
    if (!range || start === null || end === null || end < start) return null;
    originRange = { start, end };
  }

  const trail: PersistedEntityWorkspaceTab["trail"] = [];
  for (const rawEntry of source["trail"].slice(-TRAIL_LIMIT)) {
    const entry = asRecord(rawEntry);
    const id = entry ? boundedString(entry["id"]) : null;
    const displayName = entry ? boundedString(entry["displayName"]) : null;
    if (!entry || !id || !displayName) return null;
    const kind = normalizeEntityKind(entry["kind"]);
    trail.push({
      id,
      displayName,
      ...(kind ? { kind } : {}),
    });
  }
  return {
    kind: "entity",
    id: canonicalId,
    groupId: canonicalGroupId,
    entityId,
    entityKind,
    origin,
    ...(originRange ? { originRange } : {}),
    canvas,
    returnPassageTabId,
    trail,
    scrollTop,
    nonce,
  };
}

function normalizeLiveTab(
  value: unknown,
  canonicalId: string,
  canonicalGroupId: string,
): PersistedStudyWorkspaceTab | null {
  const source = asRecord(value);
  if (source?.["kind"] === "passage") {
    return normalizePassageTab(source, canonicalId, canonicalGroupId);
  }
  if (source?.["kind"] === "entity") {
    return normalizeEntityTab(source, canonicalId, canonicalGroupId);
  }
  return null;
}

function normalizeLabel(
  value: unknown,
): PersistedStudyWorkspaceGroup["label"] | null {
  const source = asRecord(value);
  if (!source) return null;
  if (source["kind"] === "custom") {
    return typeof source["value"] === "string" && source["value"].length <= 160
      ? { kind: "custom", value: source["value"] }
      : null;
  }
  if (source["kind"] !== "automatic") return null;
  if (!Object.prototype.hasOwnProperty.call(source, "frozenReference")) {
    return { kind: "automatic" };
  }
  const frozen = asRecord(source["frozenReference"]);
  const book = frozen ? boundedString(frozen["book"], 3) : null;
  const chapter = frozen ? positiveInteger(frozen["chapter"]) : null;
  return book && /^[1-3A-Z]{3}$/.test(book) && chapter !== null
    ? { kind: "automatic", frozenReference: { book, chapter } }
    : null;
}

interface RawGroup {
  id: string;
  homePassageTabId: string;
  tabIds: string[];
  lastActiveTabId: string;
  collapsed: boolean;
  label: PersistedStudyWorkspaceGroup["label"];
}

function normalizeRawGroup(value: unknown): RawGroup | null {
  const source = asRecord(value);
  if (!source || !Array.isArray(source["tabIds"]) || typeof source["collapsed"] !== "boolean") {
    return null;
  }
  const id = identifier(source["id"]);
  const homePassageTabId = identifier(source["homePassageTabId"]);
  const lastActiveTabId = identifier(source["lastActiveTabId"]);
  const label = normalizeLabel(source["label"]);
  if (!id || !homePassageTabId || !lastActiveTabId || !label) return null;
  const tabIds: string[] = [];
  for (const rawId of source["tabIds"]) {
    const tabId = identifier(rawId);
    if (!tabId) return null;
    tabIds.push(tabId);
  }
  return { id, homePassageTabId, tabIds, lastActiveTabId, collapsed: source["collapsed"], label };
}

function normalizeClosedItem(value: unknown): PersistedClosedStudyItem | null {
  const source = asRecord(value);
  const index = source ? nonNegativeInteger(source["index"]) : null;
  if (!source || index === null) return null;
  if (source["kind"] === "tab") {
    const rawTab = asRecord(source["tab"]);
    const id = rawTab ? identifier(rawTab["id"]) : null;
    const groupId = rawTab ? identifier(rawTab["groupId"]) : null;
    if (!rawTab || !id || !groupId) return null;
    const tab = normalizeLiveTab(rawTab, id, groupId);
    return tab ? { kind: "tab", tab, index } : null;
  }
  if (source["kind"] === "group") {
    const group = normalizeRawGroup(source["group"]);
    const rawTabs = asRecord(source["tabsById"]);
    if (!group || !rawTabs) return null;
    const normalizedTabs: PersistedStudyWorkspaceTab[] = [];
    const usedIds = new Set<string>();
    for (const tabId of group.tabIds) {
      if (normalizedTabs.length >= TAB_LIMIT) break;
      if (usedIds.has(tabId)) continue;
      const tab = normalizeLiveTab(rawTabs[tabId], tabId, group.id);
      if (!tab) continue;
      usedIds.add(tabId);
      normalizedTabs.push(tab);
    }
    const passageIds = normalizedTabs.flatMap((tab) => tab.kind === "passage" ? [tab.id] : []);
    if (passageIds.length === 0) return null;
    const canonicalTabs = normalizedTabs.map((tab): PersistedStudyWorkspaceTab => (
      tab.kind === "entity"
        && tab.returnPassageTabId !== null
        && !passageIds.includes(tab.returnPassageTabId)
        ? { ...tab, returnPassageTabId: null }
        : tab
    ));
    const homePassageTabId = passageIds.includes(group.homePassageTabId)
      ? group.homePassageTabId
      : passageIds[0]!;
    const tabIds = canonicalTabs.map((tab) => tab.id);
    const lastActiveTabId = tabIds.includes(group.lastActiveTabId)
      ? group.lastActiveTabId
      : homePassageTabId;
    const tabsById: Record<string, PersistedStudyWorkspaceTab> = {};
    for (const tab of canonicalTabs) tabsById[tab.id] = tab;
    return {
      kind: "group",
      index,
      group: {
        id: group.id,
        homePassageTabId,
        tabIds,
        lastActiveTabId,
        collapsed: group.collapsed,
        label: group.label,
      },
      tabsById,
    };
  }
  return null;
}

export function normalizeStudyWorkspace(value: unknown): StudyWorkspaceValidation {
  const source = asRecord(value);
  if (!source) return { ok: false, reason: "invalid" };
  const version = source["version"];
  if (typeof version === "number" && version > WORKSPACE_VERSION) {
    return { ok: false, reason: "newer-version" };
  }
  if (version !== WORKSPACE_VERSION
    || !Array.isArray(source["groups"])
    || !asRecord(source["tabsById"])
    || typeof source["activeTabId"] !== "string"
    || !Array.isArray(source["activationOrder"])
    || !Array.isArray(source["recentlyClosed"])) {
    return { ok: false, reason: "invalid" };
  }
  const rawTabs = asRecord(source["tabsById"])!;
  const groups: PersistedStudyWorkspaceGroup[] = [];
  const tabsById: Record<string, PersistedStudyWorkspaceTab> = {};
  const usedGroupIds = new Set<string>();
  const usedTabIds = new Set<string>();

  for (const rawGroupValue of source["groups"]) {
    if (groups.length >= GROUP_LIMIT || usedTabIds.size >= TAB_LIMIT) break;
    const rawGroup = normalizeRawGroup(rawGroupValue);
    if (!rawGroup) return { ok: false, reason: "invalid" };
    if (usedGroupIds.has(rawGroup.id)) continue;
    const localTabs: PersistedStudyWorkspaceTab[] = [];
    const localIds = new Set<string>();
    for (const tabId of rawGroup.tabIds) {
      if (usedTabIds.size + localIds.size >= TAB_LIMIT) break;
      if (usedTabIds.has(tabId) || localIds.has(tabId)) continue;
      if (!Object.prototype.hasOwnProperty.call(rawTabs, tabId)) continue;
      const tab = normalizeLiveTab(rawTabs[tabId], tabId, rawGroup.id);
      if (!tab) return { ok: false, reason: "invalid" };
      localIds.add(tabId);
      localTabs.push(tab);
    }
    const passageIds = localTabs.flatMap((tab) => tab.kind === "passage" ? [tab.id] : []);
    if (passageIds.length === 0) return { ok: false, reason: "invalid" };
    const canonicalTabs = localTabs.map((tab): PersistedStudyWorkspaceTab => (
      tab.kind === "entity"
        && tab.returnPassageTabId !== null
        && !passageIds.includes(tab.returnPassageTabId)
        ? { ...tab, returnPassageTabId: null }
        : tab
    ));
    const homePassageTabId = passageIds.includes(rawGroup.homePassageTabId)
      ? rawGroup.homePassageTabId
      : passageIds[0]!;
    const tabIds = canonicalTabs.map((tab) => tab.id);
    const lastActiveTabId = tabIds.includes(rawGroup.lastActiveTabId)
      ? rawGroup.lastActiveTabId
      : homePassageTabId;
    groups.push({
      id: rawGroup.id,
      homePassageTabId,
      tabIds,
      lastActiveTabId,
      collapsed: rawGroup.collapsed,
      label: rawGroup.label,
    });
    usedGroupIds.add(rawGroup.id);
    for (const tab of canonicalTabs) {
      usedTabIds.add(tab.id);
      tabsById[tab.id] = tab;
    }
  }

  if (groups.length === 0) return { ok: false, reason: "invalid" };
  const rawActivationOrder = source["activationOrder"];
  const activationOrder: string[] = [];
  const activatedIds = new Set<string>();
  for (const valueId of rawActivationOrder) {
    if (typeof valueId !== "string" || !usedTabIds.has(valueId) || activatedIds.has(valueId)) continue;
    activatedIds.add(valueId);
    activationOrder.push(valueId);
  }
  const requestedActiveId = source["activeTabId"];
  const activeTabId = usedTabIds.has(requestedActiveId)
    ? requestedActiveId
    : activationOrder.at(-1) ?? groups[0]!.lastActiveTabId;
  const normalizedActivationOrder = [
    ...activationOrder.filter((tabId) => tabId !== activeTabId),
    activeTabId,
  ];
  const recentlyClosed: PersistedClosedStudyItem[] = [];
  for (const rawItem of source["recentlyClosed"].slice(-RECENT_LIMIT)) {
    const item = normalizeClosedItem(rawItem);
    if (item) recentlyClosed.push(item);
  }
  return {
    ok: true,
    value: {
      version: WORKSPACE_VERSION,
      groups,
      tabsById,
      activeTabId,
      activationOrder: normalizedActivationOrder,
      recentlyClosed,
    },
  };
}

export function mergeStudyWorkspaceSetting(
  current: PersistedStudyWorkspaceV2 | null,
  incoming: unknown,
  hasIncomingKey: boolean,
): PersistedStudyWorkspaceV2 | null {
  if (!hasIncomingKey) return current;
  if (incoming === null) return null;
  const normalized = normalizeStudyWorkspace(incoming);
  return normalized.ok ? normalized.value : current;
}

/** Electron-store boundary for raw invalid/future values; renderer code never calls this. */
export function mergeRawStudyWorkspaceSetting(
  current: unknown,
  incoming: unknown,
  hasIncomingKey: boolean,
): unknown {
  const currentValidation = normalizeStudyWorkspace(current);
  if (!currentValidation.ok && currentValidation.reason === "newer-version") return current;
  if (!hasIncomingKey) return current;
  if (incoming === null) return null;
  const normalized = normalizeStudyWorkspace(incoming);
  return normalized.ok ? normalized.value : current;
}

export interface LegacyStudyWorkspaceMigrationInput {
  researchWorkspace: unknown;
  researchSession: unknown;
  lastRead: unknown;
  keptContext: unknown;
}

export type LegacyStudyWorkspaceMigrationResult =
  | { status: "migrated"; value: PersistedStudyWorkspaceV2 }
  | { status: "empty"; value: null };

export interface StudyWorkspaceBootstrapInput extends LegacyStudyWorkspaceMigrationInput {
  hasStudyWorkspaceKey: boolean;
  studyWorkspace: unknown;
}

export interface StudyWorkspaceBootstrapWrite {
  studyWorkspace: PersistedStudyWorkspaceV2 | null;
  researchWorkspace: null;
  researchSession: null;
  keptContext: null;
}

export interface StudyWorkspaceBootstrapResult {
  studyWorkspace: PersistedStudyWorkspaceV2 | null;
  studyWorkspaceRefusal?: "newer-version";
  write: StudyWorkspaceBootstrapWrite | null;
}

interface LegacyPassageOrigin {
  book: string;
  chapter: number;
  packageId: string;
  verse?: number;
  verseOffset?: number;
}

interface LegacyResearchOrigin extends LegacyPassageOrigin {
  verseStart?: number;
  verseEnd?: number;
}

interface LegacyResearchTab {
  id: string;
  entityId: string;
  origin: LegacyResearchOrigin;
  trail: Array<{ id: string; displayName: string; kind?: PersistedEntityKind }>;
  nonce: number;
}

interface LegacyResearchWorkspace {
  tabs: LegacyResearchTab[];
  activeTabId: string;
  activationOrder: string[];
}

function normalizeLegacyLastRead(value: unknown): LegacyPassageOrigin | null {
  const source = asRecord(value);
  if (!source) return null;
  const book = boundedString(source["book"], 3);
  const chapter = positiveInteger(source["chapter"]);
  const packageId = boundedString(source["packageId"]);
  if (!book || !/^[1-3A-Z]{3}$/.test(book) || chapter === null || !packageId) return null;
  const verse = optionalPositiveInteger(source, "verse");
  const verseOffset = optionalFiniteNumber(source, "verseOffset");
  const hasEyeLine = verse !== undefined && verse !== null
    && verseOffset !== undefined && verseOffset !== null;
  return {
    book,
    chapter,
    packageId,
    ...(hasEyeLine ? { verse, verseOffset } : {}),
  };
}

function normalizeLegacyKeptContext(value: unknown): Exclude<PersistedMarginScope, null> | null {
  const source = asRecord(value);
  if (!source) return null;
  return normalizeScope({ kind: "kept", ...source }) ?? null;
}

function normalizeLegacyResearchOrigin(value: unknown): LegacyResearchOrigin | null {
  const source = asRecord(value);
  if (!source) return null;
  const book = boundedString(source["book"], 3);
  const chapter = positiveInteger(source["chapter"]);
  const packageId = boundedString(source["packageId"]);
  if (!book || !/^[1-3A-Z]{3}$/.test(book) || chapter === null || !packageId) return null;
  const verseStart = optionalPositiveInteger(source, "verseStart");
  const verseEnd = optionalPositiveInteger(source, "verseEnd");
  if (verseStart === null || verseEnd === null
    || (verseStart !== undefined && verseEnd !== undefined && verseEnd < verseStart)) return null;
  return {
    book,
    chapter,
    packageId,
    ...(verseStart !== undefined ? { verseStart } : {}),
    ...(verseEnd !== undefined ? { verseEnd } : {}),
  };
}

function normalizeLegacyTrail(value: unknown): LegacyResearchTab["trail"] | null {
  if (!Array.isArray(value)) return null;
  const trail: LegacyResearchTab["trail"] = [];
  for (const rawEntry of value.slice(-TRAIL_LIMIT)) {
    const entry = asRecord(rawEntry);
    const id = entry ? boundedString(entry["id"]) : null;
    const displayName = entry ? boundedString(entry["displayName"]) : null;
    if (!entry || !id || !displayName) return null;
    const kind = normalizeEntityKind(entry["kind"]);
    trail.push({ id, displayName, ...(kind ? { kind } : {}) });
  }
  return trail;
}

function normalizeLegacyResearchTab(value: unknown): LegacyResearchTab | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = identifier(source["id"]);
  const entityId = boundedString(source["entityId"]);
  const origin = normalizeLegacyResearchOrigin(source["origin"]);
  const trail = normalizeLegacyTrail(source["trail"]);
  const nonce = nonNegativeInteger(source["nonce"]);
  return id && entityId && origin && trail && nonce !== null
    ? { id, entityId, origin, trail, nonce }
    : null;
}

function normalizeLegacyResearchWorkspace(value: unknown): LegacyResearchWorkspace | null {
  const source = asRecord(value);
  if (!source || !Array.isArray(source["tabs"])
    || typeof source["activeTabId"] !== "string"
    || !Array.isArray(source["activationOrder"])) return null;
  const tabs: LegacyResearchTab[] = [];
  const ids = new Set<string>();
  for (const rawTab of source["tabs"]) {
    const tab = normalizeLegacyResearchTab(rawTab);
    if (!tab || ids.has(tab.id)) continue;
    ids.add(tab.id);
    tabs.push(tab);
  }
  const activationOrder = source["activationOrder"].filter(
    (id): id is string => typeof id === "string",
  );
  return { tabs, activeTabId: source["activeTabId"], activationOrder };
}

function normalizeLegacyResearchSession(value: unknown): {
  origin: LegacyResearchOrigin;
  trail: LegacyResearchTab["trail"];
} | null {
  const source = asRecord(value);
  if (!source) return null;
  const origin = normalizeLegacyResearchOrigin(source["origin"]);
  const trail = normalizeLegacyTrail(source["trail"]);
  return origin && trail ? { origin, trail } : null;
}

function migrationView(
  origin: LegacyPassageOrigin,
  scope: PersistedMarginScope = null,
): PersistedPassageViewState {
  return {
    book: origin.book,
    chapter: origin.chapter,
    packageId: origin.packageId,
    ...(origin.verse !== undefined ? { verse: origin.verse } : {}),
    ...(origin.verseOffset !== undefined ? { verseOffset: origin.verseOffset } : {}),
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  };
}

function migrationOriginView(origin: LegacyResearchOrigin): PersistedPassageViewState {
  return migrationView({
    book: origin.book,
    chapter: origin.chapter,
    packageId: origin.packageId,
    ...(origin.verseStart !== undefined
      ? { verse: origin.verseStart, verseOffset: 0 }
      : {}),
  });
}

function legacyOriginKey(origin: LegacyPassageOrigin): string {
  return `${origin.book}:${origin.chapter}:${origin.packageId}`;
}

export function migrateLegacyStudyWorkspace(
  input: LegacyStudyWorkspaceMigrationInput,
): LegacyStudyWorkspaceMigrationResult {
  const legacyWorkspace = normalizeLegacyResearchWorkspace(input.researchWorkspace);
  const legacySession = legacyWorkspace ? null : normalizeLegacyResearchSession(input.researchSession);
  const sessionCurrent = legacySession?.trail.at(-1);
  const sessionTab: LegacyResearchTab | null = legacySession && sessionCurrent
    ? {
        id: "legacy-research-session",
        entityId: sessionCurrent.id,
        origin: legacySession.origin,
        trail: legacySession.trail,
        nonce: 0,
      }
    : null;
  const researchTabs = legacyWorkspace?.tabs ?? (sessionTab ? [sessionTab] : []);
  const firstOrigin = researchTabs[0]?.origin ?? legacySession?.origin;
  const explicitLastRead = normalizeLegacyLastRead(input.lastRead);
  const lastRead = explicitLastRead
    ?? (firstOrigin
      ? {
          book: firstOrigin.book,
          chapter: firstOrigin.chapter,
          packageId: firstOrigin.packageId,
          ...(firstOrigin.verseStart !== undefined
            ? { verse: firstOrigin.verseStart, verseOffset: 0 }
            : {}),
        }
      : {
          book: "ACT",
          chapter: 19,
          packageId: "bsb",
          verse: 1,
          verseOffset: 0,
        });
  const keptContext = explicitLastRead
    ? normalizeLegacyKeptContext(input.keptContext)
    : null;
  const reservedTabIds = new Set(researchTabs.map((tab) => tab.id));
  const allocatedTabIds = new Set<string>();
  let passageSequence = 0;
  const nextPassageId = (): string => {
    passageSequence += 1;
    const base = `study-passage-${passageSequence}`;
    let candidate = base;
    let collision = 2;
    while (reservedTabIds.has(candidate) || allocatedTabIds.has(candidate)) {
      candidate = `${base}-${collision}`;
      collision += 1;
    }
    allocatedTabIds.add(candidate);
    return candidate;
  };
  const groups: PersistedStudyWorkspaceGroup[] = [];
  const tabsById: Record<string, PersistedStudyWorkspaceTab> = {};
  const groupByOrigin = new Map<string, PersistedStudyWorkspaceGroup>();
  const createGroup = (
    origin: LegacyPassageOrigin,
    current: PersistedPassageViewState,
  ): PersistedStudyWorkspaceGroup => {
    const groupId = `study-group-${groups.length + 1}`;
    const passageTabId = nextPassageId();
    const passageTab: PersistedPassageWorkspaceTab = {
      kind: "passage",
      id: passageTabId,
      groupId,
      session: { current, history: { back: [], forward: [] } },
    };
    const group: PersistedStudyWorkspaceGroup = {
      id: groupId,
      homePassageTabId: passageTabId,
      tabIds: [passageTabId],
      lastActiveTabId: passageTabId,
      collapsed: false,
      label: { kind: "automatic" },
    };
    groups.push(group);
    tabsById[passageTabId] = passageTab;
    groupByOrigin.set(legacyOriginKey(origin), group);
    return group;
  };

  const homeGroup = createGroup(lastRead, migrationView(lastRead, keptContext));
  for (const legacyTab of researchTabs) {
    let group = groupByOrigin.get(legacyOriginKey(legacyTab.origin));
    if (!group) {
      if (groups.length >= GROUP_LIMIT || Object.keys(tabsById).length + 2 > TAB_LIMIT) continue;
      group = createGroup(legacyTab.origin, migrationOriginView(legacyTab.origin));
    }
    if (Object.keys(tabsById).length >= TAB_LIMIT || tabsById[legacyTab.id]) continue;
    const origin = migrationOriginView(legacyTab.origin);
    const tailKind = legacyTab.trail.at(-1)?.kind;
    const rangeStart = legacyTab.origin.verseStart;
    const rangeEnd = legacyTab.origin.verseEnd ?? rangeStart;
    const entityTab: PersistedEntityWorkspaceTab = {
      kind: "entity",
      id: legacyTab.id,
      groupId: group.id,
      entityId: legacyTab.entityId,
      entityKind: tailKind ?? "other",
      origin,
      ...(rangeStart !== undefined && rangeEnd !== undefined
        ? { originRange: { start: rangeStart, end: rangeEnd } }
        : {}),
      canvas: { current: migrationOriginView(legacyTab.origin), history: { back: [], forward: [] } },
      returnPassageTabId: group.homePassageTabId,
      trail: legacyTab.trail,
      scrollTop: 0,
      nonce: legacyTab.nonce,
    };
    group.tabIds.push(entityTab.id);
    tabsById[entityTab.id] = entityTab;
  }

  const sourceActivationOrder = legacyWorkspace?.activationOrder ?? ["scripture"];
  const activationOrder: string[] = [];
  const activatedIds = new Set<string>();
  for (const sourceId of sourceActivationOrder) {
    const tabId = sourceId === "scripture" ? homeGroup.homePassageTabId : sourceId;
    if (!tabsById[tabId] || activatedIds.has(tabId)) continue;
    activatedIds.add(tabId);
    activationOrder.push(tabId);
  }
  const requestedActiveId = legacyWorkspace?.activeTabId;
  const activeTabId = requestedActiveId && tabsById[requestedActiveId]
    ? requestedActiveId
    : homeGroup.homePassageTabId;
  const normalizedActivationOrder = [
    ...activationOrder.filter((tabId) => tabId !== activeTabId),
    activeTabId,
  ];
  for (const group of groups) {
    group.lastActiveTabId = [...normalizedActivationOrder].reverse().find(
      (tabId) => group.tabIds.includes(tabId),
    ) ?? group.homePassageTabId;
  }
  return {
    status: "migrated",
    value: {
      version: WORKSPACE_VERSION,
      groups,
      tabsById,
      activeTabId,
      activationOrder: normalizedActivationOrder,
      recentlyClosed: [],
    },
  };
}

export function bootstrapStudyWorkspaceSetting(
  input: StudyWorkspaceBootstrapInput,
): StudyWorkspaceBootstrapResult {
  if (input.hasStudyWorkspaceKey) {
    if (input.studyWorkspace === null) {
      const hasLegacy = input.researchWorkspace !== null && input.researchWorkspace !== undefined
        || input.researchSession !== null && input.researchSession !== undefined
        || input.keptContext !== null && input.keptContext !== undefined;
      return {
        studyWorkspace: null,
        write: hasLegacy
          ? {
              studyWorkspace: null,
              researchWorkspace: null,
              researchSession: null,
              keptContext: null,
            }
          : null,
      };
    }
    const normalized = normalizeStudyWorkspace(input.studyWorkspace);
    if (!normalized.ok && normalized.reason === "newer-version") {
      return {
        studyWorkspace: null,
        studyWorkspaceRefusal: "newer-version",
        write: null,
      };
    }
    if (normalized.ok) {
      const hasLegacy = input.researchWorkspace !== null && input.researchWorkspace !== undefined
        || input.researchSession !== null && input.researchSession !== undefined
        || input.keptContext !== null && input.keptContext !== undefined;
      const changed = JSON.stringify(input.studyWorkspace) !== JSON.stringify(normalized.value);
      return {
        studyWorkspace: normalized.value,
        write: changed || hasLegacy
          ? {
              studyWorkspace: normalized.value,
              researchWorkspace: null,
              researchSession: null,
              keptContext: null,
            }
          : null,
      };
    }
  }

  const migration = migrateLegacyStudyWorkspace(input);
  const migrated = migration.value;
  return {
    studyWorkspace: migrated,
    write: {
      studyWorkspace: migrated,
      researchWorkspace: null,
      researchSession: null,
      keptContext: null,
    },
  };
}
