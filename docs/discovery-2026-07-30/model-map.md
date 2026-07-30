Read the full model, the app wiring, the strip component, the persistence layer, the Electron validator, and the pinning tests. All paths below are in `/Users/jonnyroyal/dev/scripture-app-quire`.

---

# 1. Shapes, group membership, group creation

### Types — `src/renderer/utils/studyWorkspace.ts`

```
StudyWorkspaceStateV2                          :90-97
  version: 2
  groups: StudyWorkspaceGroup[]                // strip order AND ⌘1-9 ordinal order
  tabsById: Record<string, StudyWorkspaceTab>
  activeTabId: string
  activationOrder: string[]                    // oldest→newest, active last
  recentlyClosed: ClosedStudyItem[]

StudyWorkspaceGroup                            :79-88
  id, homePassageTabId, tabIds[], lastActiveTabId, collapsed
  label: {kind:"automatic"; frozenReference?:{book,chapter}} | {kind:"custom"; value}

StudyWorkspaceTab = PassageWorkspaceTab | EntityWorkspaceTab   :68
  PassageWorkspaceTab :35-40   {kind:"passage", id, groupId, session}
  EntityWorkspaceTab  :48-61   {kind:"entity", id, groupId, entityId, entityKind,
                                readonly origin, readonly originRange?, canvas,
                                returnPassageTabId, trail[], scrollTop, nonce}
ClosedStudyItem :70-77  {kind:"tab",tab,index} | {kind:"group",group,tabsById,index}
```

### Can a loose tab exist? **No — at four levels.**

1. **Type**: `groupId: string` is required and non-nullable on both tab kinds (`:38`, `:51`).
2. **Double bookkeeping**: membership is recorded twice — `tab.groupId` *and* `group.tabIds`. Every mutation resolves the group with the conjunction `groups.find(g => g.id === tab.groupId && g.tabIds.includes(tab.id))` (`:720-722`, `:1000-1003`, `:1520-1523`, `:1599-1602`, `:1821-1824`). A tab whose two records disagree is **inert**: every mutation returns `"unchanged"`, and it is invisible — `visibleStudyWorkspaceTabIds` (`:1922`) and `studyWorkspaceRegisterTabIds` (`:1946-1948`) both filter on `state.tabsById[tabId]?.groupId === group.id`.
3. **Persistence**: the validator only walks `rawGroup.tabIds` (`src/electron/study-workspace-settings.ts:565-581`). A tab present in `tabsById` but referenced by no group is **silently dropped on load**. Loose tabs cannot survive a restart.
4. **Group must own ≥1 passage**: enforced at load (`:583` `if (!reservedPassage) return invalid`, `:604-606`), on close (`closeStudyWorkspaceTab` refuses the last *global* passage `:1008`; `removeTabsFromGroup` bails when no passage remains `:965`), and at least one group always exists (`closeStudyWorkspaceGroup` refuses `groups.length <= 1` `:1080`; validator returns invalid on zero groups `:626`).

### Every call site that creates a group (exhaustive)

| Site | When |
|---|---|
| `createStudyWorkspace` `:424-452` | Bootstrap only. `app.tsx:735` (no persisted workspace → `study-default`/`passage-default`), `app.tsx:821` (`changeKeptContext` with null workspace), `app.tsx:1110` (`openEntityResearchAt` with null workspace) |
| `createStudyWorkspaceGroup` `:454-494` | **Exactly one caller**: `startStudyFromCurrentCanvas` (`app.tsx:1059-1091`), reachable only from the command palette row "Start and name a new study" (`CommandPalette.tsx:65-69`, `:1006`; wired `app.tsx:2303`) |
| `reopenClosedStudyItemAt` `:1497-1498` | Re-inserts a previously closed group at its recorded index |
| `migrateLegacyStudyWorkspace` `createGroup` (`study-workspace-settings.ts:937-961`, called `:963`, `:968`) | One group per distinct legacy research origin, at first launch after upgrade |

**Groups are effectively never auto-created during normal use.** `openPassageWorkspaceTab`, `openEntityWorkspaceTab`, `branchEntityWorkspaceTab`, `returnEntityWorkspaceToOrigin` all insert into the **source tab's existing group** (`:1863`, `:1579`, `:1627`). The only non-bootstrap creation is a deliberate palette action. The "auto" in `label.kind: "automatic"` refers to the *name*, not to group creation.

---

# 2. `createStudyWorkspaceGroup` and "new study FROM an existing tab"

**What it does** (`:454-494`): creates a group **plus a brand-new passage tab**, whose session is a *clone* of `input.view` with an **empty navigation history** (`:471-474`). It never touches the source tab. Guards, in order: id collision → `"unchanged"` (`:458`), `groups.length >= 16` → `"group-limit"` (`:461`), `tabsById >= 64` → `"tab-limit"` (`:464`). On success it appends the group, activates the new tab, and appends to `activationOrder` (`:487-490`). New group is born `collapsed:false`, `label:{kind:"automatic"}` (unfrozen).

Note the current UX consequence: "Start a new study" from a tab **leaves the original tab where it was and opens a duplicate**. Pinned by `tests/study-workspace.test.ts:723-739` and `tests/study-open-orchestration-contract.test.ts:85-93`.

### Does a move-tab-to-new-group path exist? **No. A new mutation is required.**

`moveStudyWorkspaceTab` (`:715-790`) requires the target to already exist — `state.groups.find(g => g.id === input.targetGroupId)`; no match → `"unchanged"` (`:723-726`). There is no `newGroupId` mint anywhere.

The compose-from-primitives route is possible but bad:
1. `createStudyWorkspaceGroup` → creates a **placeholder** tab (costs a tab slot, can hit the 64 cap).
2. `moveStudyWorkspaceTab(originalTab → newGroup)` → **always** returns `needs-confirmation`: `move-home-passage` if the tab is its group's home or the sole member (`:755-769`), `move-branch` if it has dependent entity tabs (`:770-785`). So a modal fires for the common case.
3. Close the placeholder — legal (group now has 2 passages, so no `sole-group-passage` prompt), and `removeTabsFromGroup` re-promotes `homePassageTabId` via `nearestRemainingPassageId` (`:957-965`).

Three mutations, one unavoidable dialog, a transient extra tab, and a `recentlyClosed` entry for the placeholder. **Recommend a first-class `promoteTabToNewStudyGroup(state, {tabId, groupId})`** that reuses `moveTabRecords`' bookkeeping (`:670-713`) and the same `move-branch` / `move-home-passage` confirmation machinery.

---

# 3. Group labels

### How each kind arises

- **`{kind:"automatic"}`** — the birth state of *every* group: `:445`, `:482`, and migration `study-workspace-settings.ts:955`.
- **`{kind:"automatic", frozenReference:{book,chapter}}`** — `freezeAutomaticGroupLabel` (`:512-529`) snapshots the **home tab's current** book+chapter the first time the group stops being a lone passage. Called from **7 sites**: `moveTabRecords:677`, move-entity copy-origin `:1241`, duplicate-home `:1296`, move-study destination `:1330`, `openEntityWorkspaceTab:1581`, `branchEntityWorkspaceTab:1629`, `openPassageWorkspaceTab:1865`. Rationale: a lone-passage study follows its home reference live; once it has siblings, the name freezes so navigating the home tab doesn't rename the study. Pinned `tests/study-workspace.test.ts:689-721`.
- **`{kind:"custom", value}`** — **only** `renameStudyWorkspaceGroup` (`:565-578`). Callers: `app.tsx:1370-1382` ← strip group popover form (`ScriptureWorkspaceTabs.tsx:1300-1321`), All-Tabs inline rename (`:1413-1431`), context menu "Rename study" → `beginRenameFromContext` (`:694-704`). Max 60 chars in UI (`:1313`, `:1424`), 160 at the validator (`study-workspace-settings.ts:425`).

### What renders when kind ≠ custom — **two different vocabularies**

| Surface | Function | Automatic renders as |
|---|---|---|
| Tab strip, All Tabs, active-group button, move-to-study menus | `studyWorkspaceGroupLabel` `:1991-2002` | frozen ref → `"Acts 19"`; else **home tab's live reference**; else raw `group.id` |
| **Rail switcher** (`app.tsx:1910`) | inline literal | **`"This study"`** |
| **Rail study block kicker** (`app.tsx:1875-1877`) | inline literal | **`"This study"`** |

The rail deliberately refuses the reference (comment `app.tsx:1872-1874`: an automatic group's reference "is already on screen in the register and would read here as a duplicate").

### Where duplicate display labels appear

1. **Rail switcher — guaranteed collision.** `app.tsx:1910` maps *every* automatic group to the literal `"This study"`. Two automatic groups → two visually identical rows differing only by the count badge (`:2116-2117`). Three → three. Only `aria-current` distinguishes the active one (`:2112`). This is the sharpest defect in the current design and it is masked today only because groups are almost never created.
2. **Rail study-block `aria-label`** is `studyBlockKicker` = `"This study"` (`:2125`), which can duplicate a switcher row's accessible name.
3. **Strip / All Tabs — collision on identical references.** `studyWorkspaceGroupLabel` is a pure book+chapter string, so two automatic groups both rooted at Acts 19 (or one frozen at `JHN 3` and another live at `JHN 3`) render identically in: the All-Tabs group headers (`ScriptureWorkspaceTabs.tsx:1434`), the tab-move menu (`:1553-1559`), the context-menu "Move to study…" list (`:1658-1670`), and every tab's `aria-label`/`title` (`:997-999`, `:1007`). No disambiguator exists — contrast `studyWorkspaceTabLabel`, which *does* qualify colliding tabs with the packageId (`:2004-2032`).
4. **Bug — the rail switcher's landing target ignores `lastActiveTabId`.** `app.tsx:1898-1899` documents "lands on the tab it was last on rather than its first", but `app.tsx:1905-1907` computes `landing = holdsActive ? activeTab : tabs[0]`. `group.lastActiveTabId` is never read. Switching to another study always lands on its **first** tab.
5. Related: selecting a tab in a **collapsed** group from the rail calls only `selectWorkspaceTab` → `selectStudyWorkspaceTab`, which does **not** expand (`app.tsx:2114`, `:1268-1288`). The study stays folded, the chosen tab just becomes its proxy (`:1924-1927`).

---

# 4. Capacity, collapse, reorder/move, recently-closed

### Capacity — all limits are **global**, none per-group

| Constant | Value | Site | Electron mirror |
|---|---|---|---|
| `STUDY_WORKSPACE_TAB_LIMIT` | 64 | `:227` | `study-workspace-settings.ts:3` |
| `STUDY_WORKSPACE_GROUP_LIMIT` | 16 | `:228` | `:2` |
| `RECENTLY_CLOSED_STUDY_LIMIT` | 10 | `:229` | `:6` |
| `ENTITY_RESEARCH_TRAIL_LIMIT` | 12 | `:226` | `:5` |
| `NAVIGATION_HISTORY_LIMIT` | 50 (back+forward combined) | `navigationHistory.ts:1` | `:4` |
| `STUDY_WORKSPACE_ORDINAL_LIMIT` | 9 (⌘1–⌘9) | `:1952` | — |

**There is no per-group tab cap.** Tab cap is checked as `Object.keys(state.tabsById).length >= 64` (`:464`, `:740`, `:1227`, `:1279`, `:1427`, `:1546`, `:1606`, `:1680`, `:1848`). Refusals surface as outcomes `"tab-limit"` / `"group-limit"` → toast via `utils/workspaceCapacityFeedback.ts:15-28`. UI gauge: `ScriptureWorkspaceTabs.tsx:863-870` warns within 4 of the cap. Raw-input headroom at the validator: `RAW_GROUP_LIMIT = 32`, `RAW_TAB_REFERENCE_LIMIT = 128` (`study-workspace-settings.ts:11-12`).

### Collapse — **exclusive expand, unconditional collapse**

`toggleStudyWorkspaceGroup` (`:653-668`, with a long rationale comment `:632-652`): expanding one group **collapses every other group**, including the one holding the tab being read. Collapsing is unconditional and touches nothing else. **Only one study can show its tabs at a time.** Pinned `tests/study-workspace.test.ts:2841`. A collapsed group still renders exactly one **proxy tab** in the strip — selected tab wins, else `lastActiveTabId`, else `homePassageTabId`, else first (`:1918-1931`); the proxy wears the *group* label and a count badge (`ScriptureWorkspaceTabs.tsx:960`, `:1102-1104`), middle-click on it is suppressed (`:806-809`), and clicking it expands-then-selects (`:1049-1053`). **This exclusivity rule is the single biggest obstacle to a Chrome-tab-groups strip**, where multiple groups render their members simultaneously.

### Reorder / move

```ts
type WorkspaceReorderPosition = "left" | "right" | "start" | "end";   // :580  NOT EXPORTED
```
It is re-declared in two places: `ScriptureWorkspaceTabs.tsx:28` (exported) and `app.tsx:116` (local). Any change must be made in three files.

- `reorderedIndex` `:582-591` — coarse single-step or end-stop only.
- `reorderStudyWorkspaceTab` `:593-615` — **within the tab's own group only**; never crosses a boundary.
- `reorderStudyWorkspaceGroup` `:617-630` — reorders `state.groups`, i.e. strip order *and* ⌘-ordinal order.
- Drag: `studyWorkspaceDragReorderPosition` `ScriptureWorkspaceTabs.tsx:153-168` maps a drop slot onto one of the four coarse moves; the pointer handler refuses cross-group drags outright (`:751` `origin.groupId !== groupId`), threshold 4px (`:31`, `:753`). **There is no drag-a-tab-into-another-group.**
- `moveStudyWorkspaceTab` `:715-790` — cross-group move, always via the confirmation protocol:
  - entity tab → **always** `move-entity-context` (may mint an origin passage in the target; pre-checks the tab cap `:739-742`)
  - home passage or sole member → `move-home-passage` (decisions `move-study` = merge whole group, or `duplicate-home` = leave a clone behind)
  - passage with dependent entities → `move-branch` (moves passage + dependents atomically)
  - otherwise → `moveTabRecords` directly, `"applied"`
- All confirmations carry a **staleness fingerprint** (`sourceTabIds` array + `entityNonces`) re-verified in `resolveStudyWorkspaceDecision` (`:1136-1397`); any drift → `"unchanged"`. Nine tests pin forged/stale payloads (`tests/study-workspace.test.ts:1061, 1176, 1290, 1395, 1442, 1569, 1955, 1993, 2015`).

### Recently-closed / reopen

- Ring of 10, **oldest-first, newest last**: `appendRecentlyClosedItems` `:255-262` (`.slice(-10)` + deep clone).
- Tab closes push `{kind:"tab", tab, index}` (`:848`, `:955`); group closes push a full `{kind:"group", group, tabsById, index}` snapshot (`:1067`).
- `reopenClosedStudyItem` = last index (`:1399-1403`); `reopenClosedStudyItemAt(index)` (`:1411-1513`).
- Reopening a **tab requires its group to still exist** (`:1430-1431`) — otherwise `"unchanged"`, and the entry is *not* consumed. Reopening a **group** refuses if the group id or any tab id is already live (`:1465-1468`), and is capacity-checked (`:1469-1474`).
- Entity return-links are repaired on restore: `recoverableReturnPassageTabId` (`:882-898`) for single tabs, `localReturnPassageTabId` (`:867-880`) for groups.
- `reservedStudyWorkspaceTabIds` (`:231-242`) includes recently-closed ids so derived ids (`-origin`, `-home`) never collide with a pending restore (`availableDerivedTabId :244-253`).
- UI: strip button reopens the newest (`ScriptureWorkspaceTabs.tsx:1381-1388`), All-Tabs list reopens any index, newest-first (`:1588-1605`), ⇧⌘T reopens newest (`app.tsx:1528-1532`).

---

# 5. Persistence

### Two lanes

| Lane | Entry | Behaviour |
|---|---|---|
| **Structure** | `commitStudyWorkspace` `app.tsx:575-588` → `persistStructure` | Immediate, `kind:"required"`, awaitable |
| **View** | `publishStudyWorkspaceView` `app.tsx:590-601` and `captureCurrentStudyWorkspace:551` → `publishView` | 220ms debounce (`app.tsx:744`), `kind:"view"`, coalesced |

Controller: `src/renderer/utils/workspacePersistence.ts:70-281`. Required snapshots survive queue pruning (`:191`, `:226`); a rejected write parks the **newest** snapshot in `failed`, clears the queue, and stops (`:137-154`); `retry()` re-queues it as required (`:241-250`).

**The write is a round-trip equality check** — `app.tsx:745-749`:
```ts
const persisted = await window.api.settings.set({ studyWorkspace: workspace });
if (persisted.studyWorkspaceRefusal) throw new Error("Workspace version refused");
if (!isStudyWorkspaceSnapshotAcknowledged(workspace, persisted.studyWorkspace))
  throw new Error("Workspace write not acknowledged");
```
`isStudyWorkspaceSnapshotAcknowledged` (`workspacePersistence.ts:27-33`) is canonical-JSON deep equality with sorted keys. **If the main-process validator rewrites the payload in any way, every save fails.** This is the hardest constraint on any model change: `src/renderer/utils/studyWorkspace.ts` and `src/electron/study-workspace-settings.ts` must stay shape-identical, including all six limit constants and the label union (`study-workspace-settings.ts:90-99`, `:419-439`).

Window close: `decideStudyWorkspaceClose` (`workspacePersistence.ts:40-47`) + `app.tsx:863-883` — `undefined` workspace vetoes the close, otherwise `flush()` must be acknowledged or the close is refused. Newer-version refusal short-circuits to a blocking error screen (`app.tsx:727-733`, `:1795-1807`) and blocks *all* workspace construction (INV-17).

### `studyWorkspacePersistenceReason`

`src/renderer/components/ScriptureWorkspaceTabs.tsx:117-130`. **Renderer UI copy only, not part of the model.** Maps a raw error string onto one of five fixed **four-word** reasons via regex (`read-only|EROFS|EACCES|EPERM` → "Library is read only"; `ENOSPC|no space|disk full|quota`; `newer|conflict|revision|stale`; `ENOENT|missing|not found`; fallback "Library did not answer"). Rendered beside a Retry button (`:1188-1204`). The four-word cap is asserted in `tests/study-workspace-tabs-premium-contract.test.ts:662-666`.

### What breaks if groups become reader-authored (created rarely, deliberately)

1. **Rail switcher never renders** — gated on `studySwitcher.length >= 2` (`app.tsx:2103`). Same for the study block at `>= 2` passages (`:2124`).
2. **`"This study"` becomes the permanent name** of any unnamed authored study (`app.tsx:1877`, `:1910`), and collides across every unnamed study.
3. **Naming is optional today.** `startStudyFromCurrentCanvas` opens the rename popover (`app.tsx:1087` → `openWorkspaceGroupNamingAfterCommit:969-977`, which clicks `[data-study-active-group-manage]`), but the group is already committed as `{kind:"automatic"}` (`:482`) and stays that way if the reader dismisses. An authored group should require a name at creation, or the automatic/frozen machinery (`:512-529`, 7 call sites) becomes vestigial.
4. **No empty study is representable** — every group must own a passage (validator `:583`, `:604-606`). "Create a study, then drag tabs in" is not expressible in the current state shape.
5. **Exclusive collapse becomes hostile** (`:653-668`). With 2-4 deliberate studies, expanding one folding all others is the opposite of Chrome-tab-groups. Pinned by `tests/study-workspace.test.ts:2841` — that test must be rewritten, not just relaxed.
6. **The last group cannot be closed** (`:1080`, `:1127`) — a reader who authored exactly one study can never delete it.
7. **No move-into-a-new-group** (§2) and **no cross-group drag** (`ScriptureWorkspaceTabs.tsx:751`) — both are table stakes for authored groups.
8. **`GROUP_LIMIT = 16`** is generous for auto groups, plausibly low for a library of authored studies; changing it requires editing both `studyWorkspace.ts:228` and `study-workspace-settings.ts:2`+`:11` or saves start failing.
9. **Legacy migration mints one group per distinct research origin** (`study-workspace-settings.ts:963-969`) — a bad heuristic once groups mean "a study I made"; upgraders would land in a workspace full of studies they never authored.
10. **`orderedStudyWorkspaceGroups` (`:1895-1899`) is dead in production** — only `tests/study-workspace.test.ts:142` calls it. Free to repurpose.
11. **Stale QA selectors after the kicker removal**: `scripts/qa-study-workspace-bar.mjs:371` and `scripts/qa-desktop-reading-control.mjs:575` still query `[data-study-group-tab]`, which the strip no longer emits — both will fail. `ScriptureWorkspaceTabs.tsx:859` also still guards on that dead attribute.
12. **Contract tests that assert the strip names no study** must be revisited if a group head returns: `tests/study-workspace-tabs-premium-contract.test.ts:408-470` (`doesNotMatch(/scripture-workspace-group-tab|scripture-workspace-group-head/)`, plus the `.rail-studies-item` / `.rail-studies-count` requirement), and the `groupStart` interval assertion at `:499-505` pinning `const groupStart = tabIndex === 0 && groupIndex > 0;`.

---

# 6. Every exported mutation in `studyWorkspace.ts`

**Group lifecycle**
- `createStudyWorkspace(initial, {groupId,passageTabId}) :424` — build a whole workspace: one group, one passage tab, automatic label. Bootstrap only.
- `createStudyWorkspaceGroup(state, {id,passageTabId,view}) :454` — append a new group **with a fresh cloned passage tab**, activate it. Caps: group 16, tab 64.
- `renameStudyWorkspaceGroup(state, groupId, value) :565` — set `label` to `{kind:"custom", value}`. The only producer of custom labels.
- `toggleStudyWorkspaceGroup(state, groupId) :653` — flip `collapsed`; **expanding collapses every other group**.
- `reorderStudyWorkspaceGroup(state, {groupId,position}) :617` — move a group one step or to an end within `state.groups`.
- `closeStudyWorkspaceGroup(state, groupId) :1075` — remove a group + all its tabs into `recentlyClosed`; refuses the last group or the last global passage; `>1` tab requires a `close-study` confirmation.

**Tab lifecycle**
- `openPassageWorkspaceTab(state, {id,sourceTabId,view,duplicate?}) :1816` — insert a passage tab after the source **in the source's group**; without `duplicate` it re-focuses a matching tab and pushes history instead. Freezes the group label.
- `openEntityWorkspaceTab(state, input) :1515` — insert an entity tab after the source; reuses a matching entity in-group unless `duplicate`. Freezes the group label.
- `branchEntityWorkspaceTab(state, {id,sourceTabId,entry,nonce}) :1594` — fork an entity tab, copying origin/canvas and extending the trail.
- `returnEntityWorkspaceToOrigin(state, {entityTabId,passageTabId?}) :1642` — focus (or mint) the passage matching the entity's immutable origin and re-point `returnPassageTabId`.
- `moveStudyWorkspaceTab(state, {tabId,targetGroupId}) :715` — cross-group move; target must already exist; usually returns `needs-confirmation`.
- `closeStudyWorkspaceTab(state, tabId) :995` — close one tab; refuses the last global passage; may demand `sole-group-passage` or `passage-dependencies`.
- `reopenClosedStudyItem(state) :1399` / `reopenClosedStudyItemAt(state, index) :1411` — restore the newest / any retained closed tab-or-group at its recorded index.
- `resolveStudyWorkspaceDecision(state, confirmation, decision) :1136` — apply a confirmed structural change after re-verifying the confirmation's staleness fingerprint.

**Selection / activation**
- `selectStudyWorkspaceTab(state, tabId) :531` — set `activeTabId`, `group.lastActiveTabId`, and push `activationOrder`.
- `activateStudyCanvasOwnerPassageTab(state) :557` — activate the passage tab that owns the rendered canvas (no-op if already active).

**Content updates**
- `updateStudyCanvasSession(state, tabId, fn) :1733` — replace a tab's session/canvas (history-normalized to 50).
- `updateActiveStudyCanvasSession(state, ownerTabId, fn) :1757` — same, but a no-op unless `ownerTabId` is still active (guards late async writes).
- `updateEntityWorkspaceScrollTop(state, tabId, scrollTop) :1766` — persist an entity tab's scroll offset.
- `updateEntityWorkspaceTrail(state, tabId, fn) :1783` — replace an entity trail, canonicalized and capped at 12; may upgrade `entityKind`.
- `navigateEntityWorkspaceTab(state, tabId, entry, nonce) :1712` — in-place entity drill: swap `entityId`/`entityKind`, append the trail, bump the nonce.
- `appendEntityResearchTrail(trail, entry) :270` / `truncateEntityResearchTrail(trail, index) :289` — pure trail helpers (not state mutations).

**Pure selectors (no state change)**: `studyCanvasOwnerPassageTabId :538`, `studyWorkspaceTabCloseAvailability :1101`, `studyWorkspaceGroupCloseAvailability :1122`, `activeStudyWorkspaceTab :1881`, `activeStudyWorkspaceSession :1887`, `orderedStudyWorkspaceGroups :1895` (unused in prod), `orderedStudyWorkspaceTabs :1901`, `visibleStudyWorkspaceTabIds :1918`, `studyWorkspaceRegisterTabIds :1943`, `studyWorkspaceOrdinalTabId :1959`, `studyWorkspaceTabOrdinal :1974`, `studyWorkspaceGroupLabel :1991`, `studyWorkspaceTranslationCollisionTabIds :2004`, `studyWorkspaceTabLabel :2022`, `studyWorkspaceTabLabelParts :2070`, `studyWorkspaceTabType :2086`.

---

# Tests that pin the model

| File | Pins |
|---|---|
| `tests/study-workspace.test.ts` (73 tests, 2860 lines) | The entire model: creation, labels/freeze, reorder, collapse exclusivity (`:2841`), move/close confirmation protocol + staleness, caps (`:1703`, `:1828`), reopen, clone isolation |
| `tests/scripture-workspace-tabs-async-contract.test.ts` | Every strip callback returns `Promise<boolean>`; `runApprovedIntent` commits UI only after approval; APG manual activation; no local collapse state |
| `tests/study-workspace-tabs-premium-contract.test.ts` | Visual/DOM contract — **`:408-470` asserts the strip names no study and the rail does** |
| `tests/study-open-orchestration-contract.test.ts` | `:72-93` `startStudyFromCurrentCanvas` shape; `:103-110` naming-step handshake via `[data-study-active-group-manage]` |
| `tests/scripture-workspace-strip-interactions-contract.test.ts` | Drag→reorder mapping, wheel panning, collapsed-proxy rules, recently-closed indexing |
| `tests/workspace-capacity-feedback.test.ts` | `:145` every capacity-producing action must report its outcome |
| `tests/study-workspace-settings.test.ts`, `tests/study-workspace-bootstrap.test.ts` | The Electron validator/migration — must move in lockstep with the renderer model |
| `tests/workspace-persistence.test.ts`, `tests/study-workspace-session-restore-contract.test.ts` | Controller lanes, acknowledgement, close handshake |
| `tests/study-workspace-qa-contract.test.ts` | Guards the two QA scripts (which currently carry stale `[data-study-group-tab]` selectors) |