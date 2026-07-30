Read-only discovery complete. Findings below; nothing was modified.

## 0. What the strip is, structurally

`.scripture-page` (styles.css:1463, flex column) holds `.scripture-workspace-bar` then `.scripture-body` (ScripturePage.tsx:4649–4688). The bar (styles.css:1607–1618) is `height: var(--frame-top)` / `align-items: flex-end` / `padding: var(--page-inset) var(--page-inset) 0 0`, with three flex children: the tablist viewport (`flex: 0 1 auto`), the inline `+` (`.scripture-workspace-open.is-inline`, 28×28, `margin: 0 auto 3px 4px` — the auto margin is what holds the toolbar at the far edge), and `.scripture-workspace-actions` (`height: var(--register-strip)`, `flex: 0 1 auto`). Tokens: `--page-inset: 10px` (285), `--register-strip: 30px` (298), `--frame-top: calc(...)` = 40 (299), `--radius-page: 14px` (393).

---

## 1. PLACEMENT

**Option A — second row inside `.scripture-workspace-bar`, growing `--frame-top`.**
Requires the bar to become a column (or wrap its three children in a row div). That breaks three verbatim-pinned declarations, because `auto` margins and `flex: 0 1 auto` behave differently in a column: `.scripture-workspace-viewport { flex: 0 1 auto }`, `.scripture-workspace-open.is-inline { margin: 0 auto 3px 4px }`, `.scripture-workspace-actions { flex: 0 1 auto }` — all asserted literally at actions-cluster-position-contract.test.ts:162–166.

**Option B — chips below the bar, over the page.**
Zero frame-token change, worst structurally: the page's top edge is `--frame-top` and the tab's fillets sweep into `--bg-reading` at the bar's baseline (styles.css:1817–1837), so chips below the bar sit **on paper**, not canvas. Also lands the squared top-left corner (`.scripture-workspace-bar[data-flush-start] ~ .scripture-body .scripture-content`, styles.css:3715, pinned at study-workspace-theme-contract.test.ts:168) under the chip row instead of under the tab. Reject.

**Option C — chips as a sibling element between bar and body, folded into `--frame-top`. Recommended.**
The bar's own box is untouched, so every `.scripture-workspace-bar` assertion survives (frame-top 91–116, premium 243–250). The `~ .scripture-body` rule is a *general* sibling combinator, so inserting an element between them still matches. The frame-top test's bar-height sweep (quire-frame-top-edge-contract.test.ts:98–116) only polices selectors whose **subject** is the bar, so a new element is unconstrained. Crucially, the study line then lives in `ScripturePage.tsx`, entirely outside `ScriptureWorkspaceTabs.tsx` — which matters for §4 below, because every "no study in the strip" assertion is scoped to that component's source ranges.

The one thing C must not do is keep `--frame-top` at 40. That token is the single datum three surfaces read: the rail (`.sidebar { padding-top: var(--frame-top) }`, pinned at quire-rev05-rail-frame-contract.test.ts:83), the focus-settle keyframe (focus-exchange-motion-contract.test.ts:114–117), and the page grid. Leaving it at 40 while a 24px row sits below it puts the rail's brand tile 24px out of alignment with the paper — exactly the "four datums" fault §05·2 was written against.

**Option D — overlay.** `actions-cluster-position-contract.test.ts:47/58` bans `position`/`inset` on any selector matching `[aria-current=`, `.is-current`, `.is-active`, `.is-selected` — which the active chip will carry. Legal only by positioning a non-selection-keyed container; and an overlay reserves no space, so Scripture's first line renders underneath. Reject.

**Chrome-height cost (A and C are identical here):**

| composition | `--frame-top` | delta |
|---|---|---|
| today | `10 + 30` | 40 |
| naive: add a 24px chip row | `10 + 24 + 30` | 64 (+60%) |
| absorb the drag band (chips *are* the drag region, `-webkit-app-region: drag` except on chips) | `24 + 30` | 54 (+35%) |

54 is the number the frame held before commit e8e2ee9, so the second composition is a return rather than a growth — at the cost of re-canonning the bar's padding assertion, since `padding: var(--page-inset) var(--page-inset) 0 0` is pinned verbatim at quire-frame-top-edge-contract.test.ts:92 and premium:246.

**Test files needing re-canon for A or C:**

| file | what changes |
|---|---|
| `tests/quire-frame-top-edge-contract.test.ts` | :77 sum `=== 40`; new `--study-line` token must satisfy the declared-exactly-once checks at :62–68; :92 bar padding (only in the 54 variant); **:189 `PAGE_TOP_EDGE = 54`** and the five `tooltipPlacement` cases at :202–228 |
| `src/renderer/components/Tooltip.tsx:39` | mirrored constant |
| `tests/study-workspace-tabs-premium-contract.test.ts` | :243 survives (composed token); :448–466 prose + the two `.rail-studies-*` assertions if the rail block moves |
| `tests/quire-rev05-rail-frame-contract.test.ts` | :83/:176 survive (token), but the rail's whole vertical rhythm shifts — every `docs/ui-audit/sidebar/*.png` re-shoots |
| `tests/focus-exchange-motion-contract.test.ts` | survives untouched (:114 uses the token, :116 bans literals) |
| `tests/quire-frame-canon-contract.test.ts` | `--page-inset === 10` survives; only the 54-variant touches it |
| `tests/study-workspace-theme-contract.test.ts` | :83 theme-checks every `.scripture-workspace-bar` selector across six themes; chips need coverage |
| `styles.css:2902–2955` | forced-colors enumerates every register control by name; chips must be added |

---

## 2. FILTERING

**Current derivation** (ScriptureWorkspaceTabs.tsx):

```
visibleTabIds  = visibleStudyWorkspaceTabIds(workspace)      :328   ← model-wide, all groups
rovingTabId    = studyWorkspaceRovingTabId(visibleTabIds,…)  :330
groups         = workspace.groups.map(… visibleTabs: filter) :341–349
registerTabIds = groups.flatMap(({visibleTabs}) => ids)      :890
flushStart     = activeRegisterIndex === 0 && !leadKickered  :892–894
registerSize   = studyWorkspaceRegisterTabIds(workspace)     :910   ← whole workspace
render         = groups.flatMap(… return members)            :936–1140
```

`visibleStudyWorkspaceTabIds` (studyWorkspace.ts:1918–1931) collapses each folded group to one proxy; `studyWorkspaceRegisterTabIds` (:1943–1949) keeps everything. `filteredGroups` (:360–370) is unrelated — it's the All-Tabs *search* filter.

**Minimal seam:** rename the unfiltered list and keep the identifier `groups` for the filtered one:

```ts
const allGroups = useMemo(…);                                  // was `groups`
const groups = filterStudyId ? allGroups.filter(g => g.group.id === filterStudyId) : allGroups;
```

Keeping the name `groups` preserves four verbatim assertions untouched: `groups.flatMap` (premium:63), `return members;` (premium:81), `const groupStart = tabIndex === 0 && groupIndex > 0` (premium:497), and the `role="tablist"` section boundaries used by both premium:62 and strip-interactions:166. A rename to `stripGroups` fails premium:63 outright (`/groups\.flatMap/` is case-sensitive).

**What breaks anyway:**

- **Roving tabindex reaches zero stops.** `rovingTabId` (:330) still names a tab in a hidden study, so `tabIndex={roving ? 0 : -1}` (:1003) yields no `tabIndex=0` element and the tablist drops out of Tab order — an APG violation. `handleTabKeyDown` (:833–846) cycles the same list, so ArrowRight can target a tab with no `tabRefs` entry (:846) and focus dies silently. Fix: derive `stripTabIds` from the filtered groups for roving + arrows.
- **Do NOT filter `visibleTabIds` itself.** The exit-ghost layout effect diffs it (:545–581); filtering it makes every chip switch replay a full row of collapse-out ghosts. Keeping it model-wide also preserves scripture-workspace-tabs-async-contract.test.ts:117 (`visibleStudyWorkspaceTabIds(workspace)`).
- **Chip must be slaved to `workspace.activeTabId`.** Ctrl+Tab (app.tsx:1490), ⌘1–9 (`studyWorkspaceOrdinalTabId`, studyWorkspace.ts:1959), the All-Tabs row (:1504) and reopen-recent (:676–692) all activate tabs across studies. One effect, one direction: when `tabsById[activeTabId].groupId !== filterStudyId`, follow it. `scheduleCommittedTabFocus` (:417–425) already degrades gracefully — its `[role="tab"][aria-selected="true"]` query misses and it falls back to the overflow button.
- **`flushStart` must read the filtered list** (:890–894), or a first-in-strip tab draws a left fillet with no gap to fill. That re-canons the two verbatim assertions at premium:370–371. `leadKickered` is already vestigial (there is no kicker; it just reads `!collapsed`) and should die with them.
- **Ten call sites want `allGroups`, not `groups`:** `activeGroup` (:350–353), `filteredGroups` (:360), `beginRenameFromContext` (:695), `handleCloseOthers` (:707), `handleTabPointerMove` (:757), `handleTabPointerUp` (:785), `contextGroup` (:874), the overflow gate `groups.length > 0` (:1233), the All-Tabs count (:1380), the move menus (:1553–1554, :1630). Getting one wrong silently hides a study from a "Move to study…" menu.
- **Collapsed proxies:** unchanged mechanically, but a collapsed *active* study reduces the strip to one proxy that repeats the chip's own label. See risk 6.
- **Drag/reorder:** *simplified*. `handleTabPointerMove` already resolves the insertion index within one group (`entry.visibleTabs`, :759) and `studyWorkspaceDragReorderPosition` never crosses groups by design (:153–168). Nothing changes. The loss is nil, because cross-study drag has no path today either — it's context-menu-only (:1655–1673).
- **Close-others** (:706–718) reads `entry.tabs`, not `visibleTabs` — correct as-is.
- **All-Tabs popover** (:1368–1607) reads `groups`/`filteredGroups` unfiltered — correct as-is; it is the escape hatch.
- **`hiddenTabCount` changes meaning** (:910–911). `registerSize` counts the whole workspace while `tabsInStrip` will count one study, so `+n` becomes "everything you filtered out" and the aria-label at :1250–1252 ("`${hiddenTabCount} not in the strip`") is arguably still true but no longer means what it said. Formula is pinned verbatim at premium:674.
- `useLayoutEffect` measure (:488–515) depends on `[groups]` — add the filter state.

---

## 3. CREATE-FROM-LINE

`createStudyWorkspaceGroup(state, { id, passageTabId, view })` — studyWorkspace.ts:454–494.

**An empty study is not representable.** The signature requires `passageTabId` + a `PassageViewState` and unconditionally builds the tab, then sets `homePassageTabId: tab.id`, `tabIds: [tab.id]`, `lastActiveTabId: tab.id` (:476–483) and activates it. `StudyWorkspaceGroup.homePassageTabId` is a non-optional `string` (:81), and `studyWorkspaceGroupLabel` falls back to `group.id` when the home tab is missing (:1996–2002) — an empty study would render as a raw UUID. A study must be born with a tab.

Refusals: duplicate id / taken passage id → `unchanged` (:458); ≥16 groups → `group-limit` (:461, `STUDY_WORKSPACE_GROUP_LIMIT = 16` at :228); ≥64 tabs → `tab-limit` (:464).

The `+` should reuse `startStudyFromCurrentCanvas` (app.tsx:1059–1091), which already does exactly the right thing: takes the current canvas's view, mints two UUIDs, runs the transition as `"group-change"`, notifies capacity, then calls `openWorkspaceGroupNamingAfterCommit` (:969–977) to open the rename popover. It is currently reachable **only** from the command palette (app.tsx:2303 → CommandPalette.tsx:87/1006).

Wiring cost: one new prop `onStartStudy: () => Promise<boolean>` on `ScriptureWorkspaceTabsProps` (:33–50) or on the study-line component, threaded through `ScripturePage.tsx:4652–4679`. No model change. Two caveats: `STUDY_WORKSPACE_GROUP_LIMIT` is exported but not imported by the component (:4–20), so a `atStudyCapacity` gauge mirroring `atTabCapacity` (:864–870) must be added; and `openWorkspaceGroupNamingAfterCommit` anchors on `[data-study-active-group-manage]` (app.tsx:973), so if the study line displaces the active-group control the naming flow needs a new anchor.

---

## 4. INTERACTIONS WITH WHAT WAS JUST BUILT

**The rail switcher becomes a mirror, and it is contract-pinned — you cannot simply delete it.**

`studySwitcher` (app.tsx:1901–1916) + markup (:2103–2123) + `.rail-studies` (rail.css:515–590). Two tests hold it:
- `study-workspace-tabs-premium-contract.test.ts:465–466` — rail.css must contain `.rail-studies-item {` and `.rail-studies-count {`
- `quire-rev05-rail-frame-contract.test.ts:244` — `.rail-studies-list` must use `var(--rail-label-x)`

Note it is **already invisible** in two states: `.sidebar.collapsed .rail-studies { display: none }` (rail.css:590) and the `>= 2` gate (app.tsx:2103). In those states a chip line would be the only switcher. The real hazard is landing behaviour: the rail lands on `lastActiveTabId` (app.tsx:1905–1907); a chip that filters without selecting would disagree. Recommendation: keep it, demote it to "full-length study name + count" (the rail is the only place a long name renders un-truncated — rail.css:561–573), and give the chip the same landing rule.

**Do ae49372's contracts forbid the study line?** Read the assertions, not the prose — **no**. There are exactly seven, and all seven pass for a chip line with new class names:

| assertion | scope | why a chip line passes |
|---|---|---|
| premium:459–460 `doesNotMatch(/scripture-workspace-group-tab\|scripture-workspace-group-head/)` | whole component | bans two class-name **strings**; `.study-line-chip` is neither |
| premium:81–82 `match(tablist, /return members;/)` "nothing standing for the study" | `role="tablist"` → the plus comment | a chip line outside the tablist never enters this range |
| premium:86–90 no `const groupHead` / `kickered` | `role="tablist"` → `const members =` | bans two identifiers. Note `leadKickered` **contains** `kickered` but is declared at :893, before the range — don't move it in |
| premium:288–289 `doesNotMatch(rail, /\.scripture-workspace-group-tab\b/)` | styles.css bar→topbar | one class name |
| premium:479 no `scripture-workspace-group-mark` | component | one class name |
| premium:508 no `data-study-group-active` | styles.css declarations | one attribute name |
| strip-interactions:166 collapse/expand pairing | same tablist range | untouched |

**The contracts forbid the in-row kicker specifically — by class name, by identifier name, and within the tablist's own source range. None of them says "no study may be named anywhere in the register," and none scans the bar for extra children.** Chips under the strip are not labels *in* the tab row, and the tests are written narrowly enough to know the difference.

Also relevant: premium:66 bans `role="button"` and `scripture-workspace-open` inside the tablist range, and premium:108 bans `groups.map` inside the actions toolbar — so a chip line must be outside both. Under Option C it is in a different file entirely, which sidesteps all of this.

**What must be restated is the prose, and it is substantial.** The reversed reasoning is written into the source in five places: the component's two long comment blocks at ScriptureWorkspaceTabs.tsx:937–953 and :1125–1138 (both argue "a label above the strip creates a second strip; the rail is a column that already exists"), premium:448–458 ("the rail costs the row nothing at all, which is the strongest form this claim has taken"), premium:76–80, and strip-interactions:168–179. Those are the honest cost of the change: not failing tests, but a documented ruling that the study line reverses.

---

## 5. RISK REGISTER

1. **`--frame-top` is a three-reader datum and its tooltip mirror is already stale.** `Tooltip.tsx:39` says `PAGE_TOP_EDGE = 54` while `--frame-top` resolves to 40, and quire-frame-top-edge-contract.test.ts:189 pins the 54 verbatim with five placement cases (:202–228) encoding it — the contract that exists to keep the mirror honest is currently pinning a 14px lie. *Fix the 54→40 drift in a separate commit first, so the study line moves one number instead of two.*
2. **Roving tabindex can reach zero stops.** Filter the render without filtering `rovingTabId` (:328–333) and the tablist leaves the Tab order; arrows target un-rendered tabs (:846). *Derive `stripTabIds` for roving + arrows; leave `visibleTabIds` model-wide.*
3. **Chip state must follow `activeTabId`, never lead it.** Ctrl+Tab (app.tsx:1490), ⌘1–9, All-Tabs rows and reopen all cross studies. *One effect, one direction; the strip must never show a study that doesn't contain the page you're reading.*
4. **Six verbatim source assertions sit on the filtering seam** — premium:63, :81, :370–371, :497, :674 and both section boundaries. *Keep the identifier `groups` for the filtered list and rename the unfiltered one `allGroups`; four of six then survive untouched.*
5. **`actions-cluster-position-contract.test.ts` bans geometry on any selection-keyed selector** — `SELECTION_KEY` (:58) includes `[aria-current=`, `.is-current`, `.is-active`, and the sweep covers every file in `src/renderer/styles/`. The active chip will carry one of those. *Mark it with a pseudo-element in reserved space (the pattern the test blesses at :22–29); give the chip ink, never position.*
6. **Collapse and chips are the same gesture.** Pressing the active tab collapses its study (:1075–1078) and the proxy then repeats the chip's own label; strip-interactions:197–214 pins the collapse pair verbatim, including `if (selected) {\s*await toggleGroup(group.id, true,`, so adding a guard breaks the regex. *Make collapse meaningful only in the "All" view and restate that test.*
7. **Narrow shell cannot hold two rows.** ≤979px turns the rail into a 56px bottom bar (styles.css:20516–20525) and the register already sheds its study interval (:20588). *Below the breakpoint render the chip line as the only row, or hide it exactly as `.sidebar.collapsed .rail-studies` does (rail.css:590).*
8. **Forced colours and six themes are enumerated by name.** styles.css:2902–2955 lists every register control; study-workspace-theme-contract.test.ts:83 sweeps every `.scripture-workspace-bar` selector. *Add chips to both in the same change; give the active chip `Highlight`/`HighlightText` like the active tab (:2930).*
9. **Drag-to-chip is a missing gesture, not a broken one.** `onMoveTab` (:41) and `handleMoveTab` (:649–656) already exist. *Make each chip a drop target; no model work needed.*
10. **`hiddenTabCount` silently changes meaning** (:910–911, aria-label :1250–1252, pinned premium:674). *Decide explicitly rather than letting the arithmetic drift.*
11. **An empty study is unrepresentable** (studyWorkspace.ts:454–494, :81, :1996–2002). *The `+` reuses `startStudyFromCurrentCanvas`; a study is born holding the passage you are on, rename popover open.*
12. **`+` has no group-capacity gauge.** `STUDY_WORKSPACE_GROUP_LIMIT = 16` (:228) is unimported by the component. *Mirror `atTabCapacity` (:864–870); `notifyWorkspaceCapacity` (app.tsx:1080) already handles the `group-limit` toast.*
13. **The rail switcher cannot be deleted without rewriting two contracts** (premium:465–466, rev05-rail-frame:244). *Keep it, demote it, and make both switchers land on `lastActiveTabId`.*