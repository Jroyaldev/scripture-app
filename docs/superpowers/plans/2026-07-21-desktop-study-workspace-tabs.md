# Desktop Study Workspace Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the entity-only research strip with a production-minimal desktop study workspace where passage, person, and place tabs have truthful independent state, meaningful groups, safe authored transitions, and stable premium materials in all six themes.

**Architecture:** App owns one validated `StudyWorkspaceStateV2` and renders one controlled Scripture canvas/Living Margin for the active tab. Pure reducers own tab, group, history, limits, and recovery semantics; Electron independently validates and migrates persisted settings; a single transition coordinator gates every context-changing mutation. The existing D8 phrase precision, canonical connection ordering, canvas attention, and marking-draft lifecycle remain unchanged.

**Tech Stack:** TypeScript strict mode, React, Electron, electron-store, Node test runner with `tsx`, existing CDP Electron QA harness, CSS theme tokens.

---

## Working-tree boundary

The user's seven tracked improvements were reviewed with `git diff --check`, their focused contract, lint, and both builds, then checkpointed as commit `43b4569`. Port, do not erase, its entity-kind trail data, quiet person/place glyphs, middle-click close, measured overflow/scroll-edge work, and reload assertions. Before deleting the legacy module, compare `git show --stat 43b4569` and `git show 43b4569 --` for each destination below:

| Checkpoint hunk | Required V2 destination |
|---|---|
| entity `kind` trail + normalizer | `studyWorkspace.ts` and `study-workspace-settings.ts` |
| person/place glyphs | `ScriptureWorkspaceTabs.tsx` and All Tabs rows |
| middle-click close | mixed passage/entity tab buttons |
| measured overflow/scroll edges | V2 strip with non-masking edge curtain |
| live reload assertions | migrated V2 block in `qa-desktop-reading-control.mjs` |

At every task commit, compare `git status --short`, `git diff`, and `git diff --cached` against that inventory. Do not stage `.playwright-mcp/`, `.zcode/`, `assets/`, `output/`, or `temporary-landing-idea.html` merely because they are present.

## Task 1: Add the pure version-2 workspace model

**Files:**

- Create: `src/renderer/utils/studyWorkspace.ts`
- Modify: `src/renderer/utils/navigationHistory.ts`
- Create: `tests/study-workspace.test.ts`
- Modify: `tests/navigation-history.test.ts`

- [ ] Create the test fixture `view(book, chapter, packageId)` and first failing behavior test:

  ```ts
  test("normal passage open reuses a matching tab but explicit duplicate branches", () => {
    const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
      groupId: "study-1",
      passageTabId: "acts-19",
    });
    const first = openPassageWorkspaceTab(initial, {
      id: "john-3",
      sourceTabId: "acts-19",
      view: view("JHN", 3, "BSB"),
    });
    const reused = openPassageWorkspaceTab(first.state, {
      id: "ignored",
      sourceTabId: "acts-19",
      view: view("JHN", 3, "BSB"),
    });
    const duplicate = openPassageWorkspaceTab(reused.state, {
      id: "john-3-copy",
      sourceTabId: "john-3",
      view: view("JHN", 3, "BSB"),
      duplicate: true,
    });
    assert.equal(reused.outcome, "focused");
    assert.equal(reused.state.activeTabId, "john-3");
    assert.deepEqual(reused.state.groups[0]?.tabIds, ["acts-19", "john-3"]);
    assert.deepEqual(duplicate.state.groups[0]?.tabIds, ["acts-19", "john-3", "john-3-copy"]);
  });
  ```

- [ ] Add separate tests for first-study invariants, in-place chapter convergence without history merge, and generic `PassageViewState` Back/Forward retention.
- [ ] Run `node --import tsx --test tests/study-workspace.test.ts tests/navigation-history.test.ts`; expected RED is `ERR_MODULE_NOT_FOUND` for `src/renderer/utils/studyWorkspace.js`, not a fixture/assertion error.
- [ ] Make `NavigationHistoryState`, `NavigationHistoryMove`, create/push/back/forward generic over `T extends NavigationHistoryEntry` while preserving existing default callers.
- [ ] Define JSON-safe state without note/search prose:

  ```ts
  export interface StudyWorkspaceStateV2 {
    version: 2;
    groups: StudyWorkspaceGroup[];
    tabsById: Record<string, StudyWorkspaceTab>;
    activeTabId: string;
    activationOrder: string[];
    recentlyClosed: ClosedStudyItem[];
  }

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

  export interface PassageViewState extends NavigationHistoryEntry {
    selection?: {
      packageId: string;
      pieces: Array<{ verse: number; charStart: number | null; charEnd: number | null }>;
    };
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
  ```

- [ ] Define `PassageWorkspaceTab`, `EntityWorkspaceTab`, `ClosedStudyItem`, and `EntityResearchTrailEntry`; port the existing 12-entry trail helper and entity-kind behavior from `researchWorkspace.ts` without losing uncommitted work.
- [ ] Implement `createStudyWorkspace`, `selectStudyWorkspaceTab`, `updateStudyCanvasSession`, `openPassageWorkspaceTab`, and selectors for active tab/session, labels, translations, and ordered group/tab records.
- [ ] Use `groups` and each `group.tabIds` as canonical order; `tabsById` is record storage. Do not silently repair state here—that belongs to Task 3 normalization.
- [ ] Encode passage structural reuse as group + book + chapter + package. Normal Open focuses/repositions the existing tab; explicit duplicate bypasses reuse; in-tab navigation always updates its owner even if another tab converges.
- [ ] Run `node --import tsx --test tests/study-workspace.test.ts tests/navigation-history.test.ts`; expected GREEN is all named cases passing. Then run `npm run lint` to prove the generic declarations type-check across all three tsconfigs.
- [ ] Commit only Task 1 files with `feat: add passage-first study workspace state`.

## Task 2: Complete deterministic groups, entity sessions, limits, and recovery

**Files:**

- Modify: `src/renderer/utils/studyWorkspace.ts`
- Modify: `tests/study-workspace.test.ts`

- [ ] Add one failing test per reducer decision: immutable entity origin after source/canvas navigation; related entity in-place versus explicit sibling; exact reuse key; automatic label follow then freeze; custom rename; move/reorder; active collapse without activation change; close fallback/home promotion; each close-decision branch; recently closed restore; 64-tab/16-group refusal with `assert.strictEqual(result.state, before)`.
- [ ] Run `node --import tsx --test tests/study-workspace.test.ts`; expected RED is missing named exports such as `openEntityWorkspaceTab` and `resolveStudyWorkspaceDecision`, after Task 1 cases remain green.
- [ ] Implement these mutation outcomes and reducers:

  ```ts
  export type WorkspaceMutationOutcome =
    | "opened" | "focused" | "applied" | "tab-limit"
    | "group-limit" | "needs-confirmation" | "unchanged";

  export type WorkspaceConfirmation =
    | { kind: "passage-dependencies"; tabId: string; dependentEntityIds: string[] }
    | { kind: "sole-group-passage"; groupId: string; tabId: string }
    | { kind: "close-study"; groupId: string; tabIds: string[] }
    | { kind: "move-branch"; tabId: string; dependentEntityIds: string[]; targetGroupId: string }
    | { kind: "move-entity-context"; tabId: string; targetGroupId: string }
    | { kind: "move-home-passage"; tabId: string; groupId: string; targetGroupId: string };

  export type WorkspaceDecision =
    | "close-passage-and-research" | "keep-research" | "close-study" | "keep-open"
    | "move-branch" | "copy-origin-passage" | "move-study" | "duplicate-home" | "cancel";

  export type WorkspaceMutationResult =
    | { state: StudyWorkspaceStateV2; outcome: Exclude<WorkspaceMutationOutcome, "needs-confirmation"> }
    | { state: StudyWorkspaceStateV2; outcome: "needs-confirmation"; confirmation: WorkspaceConfirmation };

  export interface OpenEntityWorkspaceInput {
    id: string;
    sourceTabId: string;
    entityId: string;
    entityKind: "person" | "place" | "other";
    nonce: number;
    origin: PassageViewState;
    originRange?: { start: number; end: number };
    returnPassageTabId: string | null;
    duplicate?: boolean;
  }

  export function openEntityWorkspaceTab(
    state: StudyWorkspaceStateV2,
    input: OpenEntityWorkspaceInput,
  ): WorkspaceMutationResult;
  export function navigateEntityWorkspaceTab(
    state: StudyWorkspaceStateV2,
    tabId: string,
    entry: EntityResearchTrailEntry,
    nonce: number,
  ): StudyWorkspaceStateV2;
  export function createStudyWorkspaceGroup(
    state: StudyWorkspaceStateV2,
    input: { id: string; passageTabId: string; view: PassageViewState },
  ): WorkspaceMutationResult;
  export function renameStudyWorkspaceGroup(
    state: StudyWorkspaceStateV2,
    groupId: string,
    value: string,
  ): StudyWorkspaceStateV2;
  export function moveStudyWorkspaceTab(
    state: StudyWorkspaceStateV2,
    input: { tabId: string; targetGroupId: string },
  ): WorkspaceMutationResult;
  export function reorderStudyWorkspaceTab(
    state: StudyWorkspaceStateV2,
    input: { tabId: string; position: "left" | "right" | "start" | "end" },
  ): StudyWorkspaceStateV2;
  export function reorderStudyWorkspaceGroup(
    state: StudyWorkspaceStateV2,
    input: { groupId: string; position: "left" | "right" | "start" | "end" },
  ): StudyWorkspaceStateV2;
  export function toggleStudyWorkspaceGroup(
    state: StudyWorkspaceStateV2,
    groupId: string,
  ): StudyWorkspaceStateV2;
  export function closeStudyWorkspaceTab(
    state: StudyWorkspaceStateV2,
    tabId: string,
  ): WorkspaceMutationResult;
  export function closeStudyWorkspaceGroup(
    state: StudyWorkspaceStateV2,
    groupId: string,
  ): WorkspaceMutationResult;
  export function resolveStudyWorkspaceDecision(
    state: StudyWorkspaceStateV2,
    confirmation: WorkspaceConfirmation,
    decision: WorkspaceDecision,
  ): WorkspaceMutationResult;
  export function reopenClosedStudyItem(
    state: StudyWorkspaceStateV2,
  ): WorkspaceMutationResult;
  ```

- [ ] Use the exact entity reuse key: group + entity ID + origin book/chapter/package + origin range; exclude eye-line, lens, scroll, and selection.
- [ ] Insert branches immediately after their source. Implement deterministic move-left/right/start/end actions; do not add drag-and-drop.
- [ ] Preserve origin when moving entity tabs. `move-entity-context` resolves by copying/reusing that immutable origin passage in the destination. `move-branch` moves a passage and its dependent entities atomically. A sole/home passage offers `move-study`, `duplicate-home`, or cancel rather than invalidating the group. `close-passage-and-research` closes both; `keep-research` clears only each dependent `returnPassageTabId`; a sole-passage close offers `close-study` or `keep-open`; cancel/keep-open return the identical state object.
- [ ] Keep at least one passage globally and one passage in every group. Cap recently closed at 10, history at 50, and trail at 12. Limits refuse and leave the exact prior object graph unchanged.
- [ ] Run `node --import tsx --test tests/study-workspace.test.ts`; expected GREEN includes each decision string above and proves the final global passage is never removed. Run `npm run lint`.
- [ ] Commit Task 2 with `feat: add study groups and recovery semantics`.

## Task 3: Validate and migrate workspace settings

**Files:**

- Create: `src/electron/study-workspace-settings.ts`
- Modify: `src/electron/main.ts`
- Modify: `src/renderer/api.ts`
- Modify: `src/renderer/app.tsx`
- Create: `src/renderer/utils/workspacePersistence.ts`
- Create: `tests/study-workspace-settings.test.ts`
- Create: `tests/workspace-persistence.test.ts`
- Create: `tests/study-workspace-bootstrap.test.ts`
- Modify: `tests/research-memory-contract.test.ts`

- [ ] Write one test per settings boundary: strict V2 validation; canonical membership repair; each cap; privacy-field dropping; newer-version refusal; absent key versus explicit null versus invalid partial set; entity kind/trail preservation; and migration from `researchWorkspace`, `researchSession`, `lastRead`, and `keptContext`. The newer-version case must assert no legacy migration is attempted and the raw saved object is not replaced byte-for-byte.
- [ ] Begin with this failing merge test:

  ```ts
  test("invalid partial workspace input retains the last valid object", () => {
    const current = validPersistedWorkspace();
    const merged = mergeStudyWorkspaceSetting(current, { version: 2, groups: [] }, true);
    assert.strictEqual(merged, current);
    assert.equal(mergeStudyWorkspaceSetting(current, null, true), null);
    assert.strictEqual(mergeStudyWorkspaceSetting(current, undefined, false), current);
  });
  ```

- [ ] Add deferred-write tests proving: writes execute serially; a structural write cancels an older debounced view snapshot; a rejected write exposes `failed` plus the latest retryable snapshot; retry never replaces live state; and close flush waits for the newest acknowledged revision. Run `node --import tsx --test tests/study-workspace-settings.test.ts tests/workspace-persistence.test.ts tests/study-workspace-bootstrap.test.ts tests/research-memory-contract.test.ts`; expected RED is `ERR_MODULE_NOT_FOUND` for one of the two new modules or a missing `mergeStudyWorkspaceSetting` export, while the checkpointed entity-kind contract stays green.
- [ ] Implement Electron-owned structural mirrors and helpers independent of renderer imports:

  ```ts
  export type StudyWorkspaceValidation =
    | { ok: true; value: PersistedStudyWorkspaceV2 }
    | { ok: false; reason: "invalid" | "newer-version" };

  export function normalizeStudyWorkspace(value: unknown): StudyWorkspaceValidation;
  export function mergeStudyWorkspaceSetting(
    current: PersistedStudyWorkspaceV2 | null,
    incoming: unknown,
    hasIncomingKey: boolean,
  ): PersistedStudyWorkspaceV2 | null;
  export function migrateLegacyStudyWorkspace(input: {
    researchWorkspace: unknown;
    researchSession: unknown;
    lastRead: unknown;
    keptContext: unknown;
  }): { status: "migrated"; value: PersistedStudyWorkspaceV2 }
    | { status: "empty"; value: null };
  ```

- [ ] Normalize caps of 16 groups, 64 tabs, 50 total Back+Forward entries per passage session (keep entries nearest the current view deterministically), 12 entity trail items, and 10 recently closed items. Drop unknown fields including `noteBody`, `noteTitle`, `quote`, and `query`.
- [ ] Repair canonical order from `groups[].tabIds`, drop unreferenced records and duplicates, require a passage per group, repair home/last-active/global active, normalize `activationOrder` to unique referenced IDs ending with active, and preserve frozen origin, kind, nonce, trail, and ordering.
- [ ] Migration precedence is valid V2, current unversioned `researchWorkspace`, legacy `researchSession`, then one default passage. A `newer-version` result is a refusal state and skips all fallback/migration writes. Seed a home passage from valid `lastRead` and copy legacy kept scope only into that lastRead-derived home, even when a distinct legacy Research tab remains active; retain unique legacy entity IDs and never overwrite V2 from compatibility keys.
- [ ] Add `studyWorkspace?: StudyWorkspaceStateV2 | null` to renderer `AppSettings`; retain legacy fields only on the Electron migration boundary. Stop writing `researchSession` and global `keptContext` after V2 settles; `lastRead` remains a compatibility mirror only.
- [ ] Add `studyWorkspaceRefusal?: "newer-version"` to the settings response. In `study-workspace-bootstrap.test.ts`, assert App branches on that value before default/migration state creation, renders a visible library-newer-than-app refusal, disables workspace persistence, and never calls `settings.set` with a `studyWorkspace` key. Make `settings:set` distinguish explicit `null` from invalid workspace input; invalid/partial input retains the last valid saved workspace.
- [ ] Implement a revisioned renderer persistence controller:

  ```ts
  export interface WorkspacePersistenceStatus {
    phase: "idle" | "saving" | "failed";
    acknowledgedRevision: number;
    pendingRevision: number | null;
    error?: string;
  }
  export interface WorkspacePersistenceController {
    publishView(state: StudyWorkspaceStateV2): void;
    persistStructure(state: StudyWorkspaceStateV2): Promise<boolean>;
    flush(state: StudyWorkspaceStateV2): Promise<boolean>;
    retry(): Promise<boolean>;
    status(): WorkspacePersistenceStatus;
    dispose(): void;
  }
  export function createWorkspacePersistenceController(input: {
    write(state: StudyWorkspaceStateV2): Promise<unknown>;
    debounceMs: number;
  }): WorkspacePersistenceController;
  ```

- [ ] Increment a monotonic revision for every publication, serialize writes, cancel an older debounce before structural enqueue, acknowledge only the matching revision, and retry only the newest failed snapshot. A failure never mutates App's live workspace or Electron's last valid object.
- [ ] Run `node --import tsx --test tests/study-workspace-settings.test.ts tests/workspace-persistence.test.ts tests/study-workspace-bootstrap.test.ts tests/research-memory-contract.test.ts`; expected GREEN includes App-level INV-17 refusal, serialization, stale-view cancellation, retry, close-flush ordering, raw-object non-overwrite for newer versions, and invalid partial preservation. Then run `npm run lint && npm run build`.
- [ ] Commit Task 3 with `feat: migrate study workspace settings to v2`.

## Task 4: Add one authored workspace-transition gate

**Files:**

- Create: `src/renderer/utils/workspaceTransition.ts`
- Create: `tests/workspace-transition.test.ts`
- Modify: `src/renderer/components/NoteCapture.tsx`
- Modify: `src/renderer/components/ConnectionCard.tsx`
- Modify: `src/renderer/components/ScripturePage.tsx`
- Modify: `src/renderer/app.tsx`
- Modify: `src/electron/main.ts`
- Modify: `src/electron/preload.ts`
- Modify: `src/renderer/api.ts`
- Modify: `tests/desktop-reading-control.test.ts`
- Modify: `tests/shared-controls-contract.test.ts`
- Modify: `tests/marking-surfaces-contract.test.ts`

- [ ] Start with this failing coordinator test, then split additional cases for owner order, first veto, thrown/rejected owner, and concurrent requests:

  ```ts
  test("a veto prevents later owners and leaves the commit untouched", async () => {
    const calls: string[] = [];
    const coordinator = createWorkspaceTransitionCoordinator(() => [
      { requestExit: async () => { calls.push("note"); return false; } },
      { requestExit: async () => { calls.push("marking"); return true; } },
    ]);
    let committed = false;
    const result = await coordinator.run("tab-change", () => { committed = true; });
    assert.equal(result, false);
    assert.deepEqual(calls, ["note"]);
    assert.equal(committed, false);
  });
  ```

- [ ] Run `node --import tsx --test tests/workspace-transition.test.ts`; expected RED is missing `createWorkspaceTransitionCoordinator`, not an asynchronous test timeout.
- [ ] Define:

  ```ts
  export type WorkspaceTransitionReason =
    | "tab-change" | "tab-close" | "group-change" | "chapter-change"
    | "translation-change" | "view-change" | "library-change" | "window-close";

  export interface WorkspaceExitController {
    requestExit(reason: WorkspaceTransitionReason): Promise<boolean>;
  }
  export interface WorkspaceTransitionCoordinator {
    run(reason: WorkspaceTransitionReason, commit: () => void | Promise<void>): Promise<boolean>;
  }
  export function createWorkspaceTransitionCoordinator(
    owners: () => readonly WorkspaceExitController[],
  ): WorkspaceTransitionCoordinator;
  ```

- [ ] Expose controllers from `NoteCapture` and `ConnectionCard` that keep their existing Save/Discard/Keep language and mutation recovery. Include local dirty form state, in-flight mutations, and recovery—not only the existing connection-draft controller.
- [ ] Aggregate marking draft, note capture/edit, dirty connection card, in-flight mutation, and recovery in `ScripturePage`. Preserve registry-owned Escape semantics; do not make the transition coordinator a competing Escape heuristic.
- [ ] Make App the sole structural transition entry point: `runWorkspaceTransition(reason, commit)`. For dependency-sensitive close/move, the order is: obtain an explicit `WorkspaceDecision`; ask every authored owner; apply exactly one `resolveStudyWorkspaceDecision` commit; then move focus/close popovers. Cancel/veto leaves state, collapse, overflow, and focus untouched. Strip intent callbacks return `Promise<boolean>` and never mutate local UI optimistically.
- [ ] Keep global workspace shortcuts inert in text entry, dialog, popover, recovery, or another active keyboard layer.
- [ ] Reuse the existing main-process pending-close protocol with this exact renderer sequence: await the aggregate authored gate; call `captureCurrent()`; apply that `PassageViewState` to `workspaceRef.current` through owner-tagged `updateStudyCanvasSession`; synchronously publish the resulting `StudyWorkspaceStateV2` to the ref/state; await `workspacePersistence.flush(nextWorkspace)`; only then call `resolveCloseRequest(true)`. Any Keep Editing, capture/save failure, in-flight mutation, recovery state, or flush failure sends false and leaves the real BrowserWindow open.
- [ ] Route Electron `app.before-quit` through the same pending close request instead of setting `isAppQuitting` early and bypassing the renderer. A pending app quit sends one close request; a false response cancels quit; a true response/flush acknowledgement sets the quit-approved flag, then runs `shutdownForQuitDeadline()` and exits. Add main-source assertions that both titlebar/window close and app quit wait for the same acknowledgement.
- [ ] Add source contracts that NoteCapture and ConnectionCard register/unregister their controllers; connection-card save sends one combined payload; in-flight/recovery fail closed; and rejected select/close/move/collapse intents leave component-local popover/focus state unchanged.
- [ ] Run `node --import tsx --test tests/workspace-transition.test.ts tests/desktop-reading-control.test.ts tests/shared-controls-contract.test.ts tests/marking-surfaces-contract.test.ts`; expected GREEN includes clean, veto, rejection, dedupe, dependency-choice ordering, and OS-close wiring. Then run `npm run lint`.
- [ ] Commit Task 4 with `fix: gate workspace changes behind authored drafts`.

## Task 5: Make the Scripture canvas and Living Margin tab-owned

**Files:**

- Modify: `src/renderer/components/ScripturePage.tsx`
- Modify: `src/renderer/components/LivingMargin.tsx`
- Modify: `src/renderer/components/LanguageWordsSection.tsx`
- Modify: `src/renderer/components/ScriptureWorkspaceTabs.tsx`
- Modify: `src/renderer/app.tsx`
- Modify: `tests/navigation-history.test.ts`
- Modify: `tests/held-context-contract.test.ts`
- Modify: `tests/return-paths-contract.test.ts`
- Create: `tests/study-workspace-contract.test.ts`

- [ ] Create a source contract that first asserts `ScripturePage` exposes `sessionOwnerTabId`, owner-tagged `onSessionEntryChange`, and an owner-change restore effect, and App no longer declares global `canvasSessionEntry`/`navigationHistory`. Add behavior tests for exact book/chapter/package, eye-line, quote-free selection pieces, kept scope, active Study lens, per-lens scroll, Words verse/follow mode, and independent Back/Forward.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts tests/navigation-history.test.ts tests/held-context-contract.test.ts tests/return-paths-contract.test.ts`; expected RED is the `sessionOwnerTabId` source assertion while all unchanged navigation cases stay green.
- [ ] Replace the global App `navigationHistory`, `canvasSessionEntry`, `researchWorkspace`, and separately persisted kept context with the active tab/session from `StudyWorkspaceStateV2`.
- [ ] In this task—not Task 7—migrate `ScriptureWorkspaceTabs` and its ScripturePage call site to accept `workspace: StudyWorkspaceStateV2` and render ordered mixed passage/entity records without a pinned global Scripture adapter. Keep styling/actions basic but compilable; Task 7 adds the complete group manager, APG behavior, and premium polish on this truthful V2 boundary.
- [ ] Change ScripturePage to controlled session props:

  ```ts
  sessionOwnerTabId: string;
  sessionEntry: PassageViewState;
  navigationHistory: NavigationHistoryState<PassageViewState>;
  onSessionEntryChange(ownerTabId: string, entry: PassageViewState): void;
  onNavigationHistoryChange(
    ownerTabId: string,
    history: NavigationHistoryState<PassageViewState>,
  ): void;
  onSessionControllerChange?(controller: { captureCurrent(): PassageViewState | null } | null): void;
  ```

- [ ] Extend `captureNavigationEntry()` with quote-free package-local selection pieces and all meaningful margin state. Add an owner-change restore effect; initialization-only `useState` is insufficient.
- [ ] Tag every debounced/delayed canvas publication with `ownerTabId` so a previous tab's 220ms settle cannot write into a newly active tab.
- [ ] Move LivingMargin's local workspace/per-lens scroll Maps and `LanguageWordsSection` engagement/follow state into controlled `marginSession`; retain only ephemeral fetch/UI state locally. Move entity trail helpers to `studyWorkspace.ts` and keep the user-added entity kind.
- [ ] Entity reference follows update only that entity tab's canvas while Research remains visible. Passage tabs remain unchanged. VersePeek `Keep in Study` continues to freeze scope; add/use separate `Open passage tab` wording for branching.
- [ ] V2 is authoritative after load. ScripturePage may mirror active canvas into `lastRead` but must not load `lastRead` over the controlled owner.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts tests/navigation-history.test.ts tests/held-context-contract.test.ts tests/return-paths-contract.test.ts`; expected GREEN includes a simulated delayed publication from owner A after selecting owner B that leaves B unchanged. Then run `npm run lint && npm run build:renderer`.
- [ ] Commit Task 5 with `feat: retain reading state per study tab`.

## Task 6: Integrate passage/entity creation and truthful navigation

**Files:**

- Modify: `src/renderer/app.tsx`
- Modify: `src/renderer/components/ScripturePage.tsx`
- Modify: `src/renderer/components/LivingMargin.tsx`
- Modify: `src/renderer/components/CommandPalette.tsx`
- Modify: `src/renderer/components/VersePeek.tsx`
- Modify: `tests/command-palette-contract.test.ts`
- Modify: `tests/return-paths-contract.test.ts`
- Modify: `tests/desktop-reading-control.test.ts`

- [ ] Write failing contracts for `+ Open` destinations/recents, person/place creation, entity in-place trail, explicit branch, entity-reference canvas attention, modifier/middle-click Scripture branching, same-chapter range reuse with history, explicit duplicate, `Open as passage tab`, closed-origin Return recreation/reuse, previous/next chapter in place, explicit previous/next in new tab, translation collision labels, active-tab-only hydration, invalid-chapter fallback without record deletion, named unavailable entities, retryable persistence failure, and no silent 64-tab eviction.
- [ ] Run `node --import tsx --test tests/command-palette-contract.test.ts tests/return-paths-contract.test.ts tests/desktop-reading-control.test.ts`; expected RED names the first missing `studyWorkspace` integration callback (not a broken legacy D8 assertion).
- [ ] Initialize one V2 workspace after settings load and hydrate/fetch only `activeTabId`; inactive tabs remain metadata. Persist structural mutations immediately and debounce only view snapshots. Flush live captured session before Electron window close.
- [ ] Add destination-aware Open-tab flow using existing reference/name search infrastructure. Its heading names the destination study, passage mode initially focuses the reference field and shows recent passages, and Names results teach the quiet person/place glyphs:
  - `Open passage in this study…`
  - `Research person or place…`
  - `Start new study from <active reference>`
- [ ] Starting a study copies the active canvas snapshot into a new home passage and leaves the source tab/group unchanged; its refusal at 16 groups is non-mutating.
- [ ] Make chapter arrows/picker mutate the active tab's canvas and history only. Add contextual `Open previous/next chapter in new tab`; do not create a tab from ordinary arrows. Passage picker/reference rows and VersePeek expose contextual `Open passage tab`; modifier/middle-click on a Scripture reference invokes the same branch; VersePeek `Keep in Study` remains margin-scope control.
- [ ] Opening a range in an existing same-group chapter/translation focuses it, pushes its old view into that tab's Back history, and applies the range. Only explicit Duplicate creates another same-identity tab. `Return to <origin>` creates or reuses a passage from immutable origin if `returnPassageTabId` is gone.
- [ ] Plain Study person/place activation opens a research tab in the current study. Related entity activation drills in place; modifier/middle-click or row action branches.
- [ ] An entity branch inherits the parent entity tab's immutable opening origin/return passage while copying its current canvas. If its old return tab has navigated away, Return reuses or creates the immutable origin reference and never overwrites the moved tab.
- [ ] In entity Research, a Scripture reference navigates that entity canvas and brings the anchor into attention without hiding Research; `Open as passage tab` creates/focuses a sibling passage.
- [ ] Entity Research headers always show `Opened from <origin>` and additionally `Viewing <current>` when the independent canvas differs. `Return to <origin>` uses the immutable snapshot and never silently retargets to the current group home.
- [ ] If an active passage is invalid/missing, render a visible fallback using its group's home passage without deleting or rewriting the stored tab. If entity lookup fails, keep the tab and its last named trail entry with an unavailable state and Close action.
- [ ] Track workspace persistence as `idle | saving | failed`; a failed `settings.set` keeps live state and the last valid saved object, announces a calm retry action, and retries the same snapshot. Surface calm tab/group-limit outcomes that open All Tabs without evicting state. Do not add mobile behavior or breakpoints.
- [ ] Run `node --import tsx --test tests/command-palette-contract.test.ts tests/return-paths-contract.test.ts tests/desktop-reading-control.test.ts`; expected GREEN covers every creation/Return/fallback case. Then run `npm run lint && npm run build:renderer`.
- [ ] Commit Task 6 with `feat: open passages and research in study tabs`.

## Task 7: Rebuild the premium workspace strip and All Tabs manager

**Files:**

- Modify: `src/renderer/components/ScriptureWorkspaceTabs.tsx`
- Modify: `src/renderer/components/ScripturePage.tsx`
- Modify: `src/renderer/components/ShortcutsOverlay.tsx`
- Modify: `src/renderer/app.tsx`
- Modify: `tests/study-workspace-contract.test.ts`
- Modify: `tests/desktop-truth-keyboard-contract.test.ts`

- [ ] Add source/component tests for one global tablist containing only real tabs/collapsed proxies/presentation labels, one wrapping roving tab stop, `aria-selected`/`aria-controls` plus one labelled tabpanel, APG Left/Right/Home/End, Tab-to-panel without focus theft, Delete/Backspace close, focus-safe close, collapsed active proxy, searchable grouped All Tabs, non-destructive initial focus, deterministic group/tab move actions, reopen shortcut, F6 participation, and shortcut suppression in editors/layers. The first assertion must reject any group-toggle button below `role="tablist"`.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts tests/desktop-truth-keyboard-contract.test.ts`; expected RED reports the current interactive group toggle inside the tablist and retired pinned Scripture semantics.
- [ ] Extend the Task 5 V2 `ScriptureWorkspaceTabs` boundary to this explicit async-intent contract and remove any remaining inferred origin groups/local collapsed state:

  ```ts
  interface ScriptureWorkspaceTabsProps {
    workspace: StudyWorkspaceStateV2;
    bookNames: BookNameData;
    onSelectTab(tabId: string): Promise<boolean>;
    onToggleGroup(groupId: string): Promise<boolean>;
    onCloseTab(tabId: string): Promise<boolean>;
    onCloseGroup(groupId: string): Promise<boolean>;
    onRenameGroup(groupId: string, value: string): Promise<boolean>;
    onMoveTab(tabId: string, targetGroupId: string): Promise<boolean>;
    onReorderTab(tabId: string, position: ReorderPosition): Promise<boolean>;
    onReorderGroup(groupId: string, position: ReorderPosition): Promise<boolean>;
    onReopenClosed(): Promise<boolean>;
    onOpenTab(): void;
  }
  ```
- [ ] Render passage tabs as references and research tabs as names with the preserved quiet person/place glyphs. Show translation suffix only for same-reference collisions; accessible names/tooltips/All Tabs always include translation, kind, origin, and group as needed.
- [ ] Keep the single row 36–40px below the Scripture toolbar. Keep measured overflow, middle-click close, hover/focus/selected close, and valid focus restoration. Expanded groups omit repeated count badges; collapsed proxies show the group's `lastActiveTabId`, remain selectable without changing the active tab merely from collapse, and show counts with All Tabs.
- [ ] Make `+ Open` readable at normal width and collapse it to an icon only after labels require space; accessible names and tooltips still say `Open tab` and `All tabs`. All Tabs is searchable by group/reference/entity metadata only and rows expose group, type, label, and current state. First focus is search/current row, never Close group; every group's management lives there, while only active-group management appears in the sibling action rail.
- [ ] Add deterministic move/reorder/rename/close-study actions and recently-closed reopen. Dependent passage close offers the exact design outcomes, a multi-tab study asks for confirmation, and the final global passage has no close affordance rather than a disabled one. Do not add drag-and-drop, archive, split panes, saved layouts, or resource tabs. Rename copy encourages study-question names rather than counselee names.
- [ ] Add `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Delete`/`Backspace`, `Cmd/Ctrl+W`, `Cmd/Ctrl+Shift+T`, and F6 strip entry to the existing keyboard ownership model and Shortcuts overlay. Activation from the strip retains tab focus; Tab enters the labelled panel; content-originated research may focus its heading once but later tab switching does not steal focus.
- [ ] Hide the strip in existing Focus mode. Keep mobile compact fallback unchanged.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts tests/desktop-truth-keyboard-contract.test.ts`; expected GREEN proves rejected async intents leave active tab, collapse, popover, and focus unchanged and accepted close/collapse/overflow land on a visible tab. Then run `npm run lint && npm run build:renderer`.
- [ ] Commit Task 7 with `feat: add premium grouped study tab controls`.

## Task 8: Fix theme material, focus, and target geometry

**Files:**

- Modify: `src/renderer/styles.css`
- Modify: `tests/study-workspace-contract.test.ts`

- [ ] Add CSS source contracts that match six explicit `--workspace-bar-bg`/`--workspace-active-bg` pairs and reject `mask-image`, `.is-scripture::before`, an actions gradient, selected-tab `transparent` mixing, and `--study-gold-focus` in workspace focus rules. Assert `min-width`/`min-height` 24px for every named action and forced-colors/reduced-motion selectors.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts`; expected RED points first to the checkpointed `.scripture-workspace-viewport.is-scrollable-right` mask or `.is-scripture::before` slab.
- [ ] Add exactly these resolved theme materials:

  ```css
  /* Paper */       --workspace-bar-bg: #F7F1E6; --workspace-active-bg: #FCF8EF;
  /* Ink */         --workspace-bar-bg: #13110E; --workspace-active-bg: #1D1915;
  /* Glass */       --workspace-bar-bg: rgba(250,246,238,.78); --workspace-active-bg: rgba(255,252,246,.92);
  /* Candlelight */ --workspace-bar-bg: rgba(25,21,18,.80); --workspace-active-bg: rgba(45,37,31,.94);
  /* Porcelain */   --workspace-bar-bg: #F7F7F9; --workspace-active-bg: #FFFFFF;
  /* Onyx */        --workspace-bar-bg: #18181B; --workspace-active-bg: #232326;
  ```

- [ ] Paint the rail material once and selected material once. Glass/Candlelight apply topbar blur/saturation. Actions are transparent on the same rail; an opaque noninteractive edge curtain/divider replaces the label-opacity mask.
- [ ] Use one neutral active plate plus solid `var(--text-secondary)` baseline—no inset border/shadow/stack-card silhouette or categorical halo. Give the active tab readable width and compact inactive tabs before overflow. Use at least 12px tab and human group labels, full-contrast glyphs, and at least 24×24 close/open/all-tabs/disclosure/proxy targets.
- [ ] Use `2px solid var(--study-gold)` focus with positive offset. In forced colors use `Highlight`/`HighlightText`, system focus, `CanvasText` group keylines, currentColor icons, and no masks. Reduced motion removes entry/reorder/disclosure transitions.
- [ ] Keep the desktop bar reachable at 150% and 200% zoom; a CSS viewport-width breakpoint alone must not hide it as if the desktop window were mobile.
- [ ] Run `node --import tsx --test tests/study-workspace-contract.test.ts`; expected GREEN rejects all nested-alpha/mask/slab regressions and finds all six resolved token pairs. Then run `npm run lint && npm run build:renderer`.
- [ ] Commit Task 8 with `fix: stabilize study tab materials across themes`.

## Task 9: Verify the real Electron workflows and six-theme bar

**Files:**

- Modify: `scripts/qa-desktop-reading-control.mjs`
- Create: `scripts/qa-study-workspace-bar.mjs`
- Modify: `package.json`
- Create: `tests/study-workspace-qa-contract.test.ts`
- Runtime artifacts only: `output/playwright/study-workspace-bar/*.png`

- [ ] First add a source contract requiring the existing isolated temp library, exact Acts 19 phrase fixture, reverse-created connection fixture, canvas-attention assertions, draft-exit assertions, byte-stable authored-log check, and the user's reload/entity-kind assertions. Add required selector/step markers for all new workflow and theme cases below.
- [ ] Run `node --import tsx --test tests/study-workspace-qa-contract.test.ts`; expected RED reports missing V2 Acts/John/Romans or six-theme harness markers while all preserved D8 markers pass.
- [ ] Replace only the obsolete pinned-Scripture/entity-only block with a deterministic 1180×900 workflow: Acts 19, John 3, Romans 6, distinct per-tab view states, Apollos/Ephesus, in-place Priscilla drill, explicit entity branch, entity reference canvas/Back, second renamed group, move, collapse proxy, All Tabs search, close/reopen, reload, and exact restoration.
- [ ] In a separate startup fixture, persist 64 valid tab metadata records and instrument chapter/entity request counts. After reload, assert exactly the active tab hydrates/fetches until another tab is selected. Also seed one invalid chapter and one missing entity: the first visibly falls back to its home without deleting its stored record; the second retains its named unavailable tab and Close action.
- [ ] Add real BrowserWindow close, tab switch, close, move, and collapse attempts while NoteCapture is dirty, ConnectionCard is dirty, a mutation is in flight, and recovery owns the command. Prove each unresolved owner keeps the process, state, popover, and focus unchanged; resolve it once, flush the latest workspace revision, then prove the requested transition occurs. Keep the scenario bounded; do not add route digests or mobile matrices.
- [ ] Add build-free runners plus the normal build-owning public command to `package.json`:

  ```json
  "qa:desktop-reading-control:run": "node scripts/qa-desktop-reading-control.mjs",
  "qa:desktop-reading-control": "npm run build && npm run build:renderer && npm run qa:desktop-reading-control:run",
  "qa:study-workspace-bar:run": "node scripts/qa-study-workspace-bar.mjs",
  "qa:study-workspace-bar": "npm run build && npm run build:renderer && npm run qa:study-workspace-bar:run"
  ```

- [ ] Seed one validated V2 state at 1180×900: named expanded study, collapsed study, Acts 19 BSB/KJV collision, person, place, long label, active entity, and All Tabs open. Resolve real entity IDs before seeding, wait for fonts plus two animation frames, and use stable role/name or `data-study-*` selectors.
- [ ] Capture the identical real-app state to `paper.png`, `ink.png`, `glass.png`, `candlelight.png`, `porcelain.png`, and `onyx.png` under `output/playwright/study-workspace-bar/` without screenshot hashes.
- [ ] For each theme assert resolved nontransparent material tokens, active alpha at least .9, label opacity 1, 36–40px rail, correct blur on Glass/Candlelight, no second action layer, no intercepted label center, readable active/compact inactive widths, visible selected-close/type/group controls, and neutral group chrome with no halo. Parse focus/background RGB, compute `(lighter + .05) / (darker + .05)`, and require >=3 for the solid-gold outline.
- [ ] For Glass and Candlelight, sample the actual composited pixels behind every label bound and require >=4.5:1 full-opacity small-text contrast. Add bounded 150% and 200% zoom checks that retain Open, All Tabs, active identity/proxy, focus, and keyboard reachability.
- [ ] Run one forced-colors + reduced-motion pass: exactly one roving tab, ArrowRight skips management controls, nontransparent >=2px focus outline, system selection/keylines, every relevant target >=24×24 and hit-testable at center, Escape/focus return, and zero motion durations.
- [ ] Run `node --check scripts/qa-desktop-reading-control.mjs && node --check scripts/qa-study-workspace-bar.mjs && node --import tsx --test tests/study-workspace-qa-contract.test.ts`; expected GREEN proves the harness is syntactically valid and contains every preserved/new bounded assertion. Reserve the expensive real executions for Task 10.
- [ ] Commit Task 9 source changes (not unrelated user artifacts) with `test: verify desktop study workspace tabs`.

## Task 10: Remove legacy UI state, update status, and land

**Files:**

- Delete after all imports migrate: `src/renderer/utils/researchWorkspace.ts`
- Modify: `tests/desktop-reading-control.test.ts`
- Modify: `tests/research-memory-contract.test.ts`
- Modify: `tests/command-palette-contract.test.ts`
- Modify: `tests/return-paths-contract.test.ts`
- Modify: `STATUS.md`
- Modify: `tasks/D8-desktop-reading-precision-and-research-control.md`

- [ ] Before deletion, run `git show 43b4569 -- src/renderer/utils/researchWorkspace.ts src/renderer/components/ScriptureWorkspaceTabs.tsx src/renderer/components/LivingMargin.tsx src/electron/main.ts scripts/qa-desktop-reading-control.mjs tests/research-memory-contract.test.ts` and check off every row in the Working-tree boundary map against its V2 destination. Delete the legacy file only when entity kind, glyphs, middle-click, overflow, and reload proof are all present.
- [ ] Run `rg -n "researchWorkspace|SCRIPTURE_WORKSPACE_ID|canvasSessionEntry|const \\[navigationHistory" src/renderer tests` and update only the four listed contract files until no assertion/import names the retired pinned model. Separately prove legacy Electron keys occur only in migration input and cannot overwrite V2.
- [ ] Update D8 in both `STATUS.md` and Goal 4/landing evidence of `tasks/D8-desktop-reading-precision-and-research-control.md` to describe passage-first V2 tabs, independent passage/entity canvases, meaningful groups, transition safety, premium materials, and bounded verification. Preserve D8 Goals 1–3 and do not rewrite the frozen build spec or broaden another task.
- [ ] Run `git diff --check` and review `git status --short`; preserve the user's unrelated untracked artifacts.
- [ ] Run the final bounded gate exactly once:

  ```sh
  npm run lint
  npm run build
  npm run build:renderer
  npm test
  npm run qa:desktop-reading-control:run
  npm run qa:study-workspace-bar:run
  ```

- [ ] Inspect the real app screenshot at `output/playwright/study-workspace-bar/paper.png` (and the other five theme captures) before claiming visual completion.
- [ ] Dispatch a final spec review against `docs/superpowers/specs/2026-07-21-desktop-study-stack-tabs-design.md`, then a code-quality review. Fix every critical/important issue and rerun the smallest affected gate.
- [ ] Commit any final review/status fixes with `feat: land desktop study workspace tabs`.
- [ ] Report the exact commits, verification counts, deferred architecture items, and attach a real-app screenshot by absolute path. Stage/commit only repository files intentionally changed for this goal.

## Self-review checklist

- Every included design-spec behavior maps to a task and verification; mobile, drag reorder, saved layouts, split panes, resources, sync, and archive remain excluded.
- Passage arrows are in-place; tab creation is explicit. Groups model study questions. Entity origins never drift, while entity canvases can navigate independently.
- Workspace state is versioned, bounded, privacy-safe, and never writes authored Substrate without explicit user action.
- All authored/recovery owners can veto a transition before any state or focus mutation.
- Theme materials protect label contrast without stacked opacity; APG semantics contain only tabs/proxies; All Tabs never starts on a destructive action.
- The final gate is one focused state suite, one representative Electron behavior path, six directly comparable bar screenshots, and one forced-colors pass—not an exhaustive surface matrix.
