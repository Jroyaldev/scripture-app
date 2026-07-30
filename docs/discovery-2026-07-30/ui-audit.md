I have everything I need. Writing up the audit.

## 1. AFFORDANCE MAP — every group operation and its surface

Component: `/Users/jonnyroyal/dev/scripture-app-quire/src/renderer/components/ScriptureWorkspaceTabs.tsx`

| Operation | Surface(s) | Evidence |
|---|---|---|
| **Collapse expanded study** | (a) **pointer click on the already-active tab** — the only in-strip gesture, zero affordance, no tooltip, no cursor change; (b) actions-toolbar **"Manage {study}" → popover → "Collapse tabs"**; (c) All Tabs popover → per-group "Collapse" | (a) `ScriptureWorkspaceTabs.tsx:1075-1078`; (b) `:1345-1351`; (c) `:1468-1474` |
| **Expand collapsed study** | (a) pointer click on the collapsed proxy tab; (b) Manage popover → "Expand tabs"; (c) All Tabs → "Expand"; (d) right-click proxy → "Expand study" | `:1049-1053`, `:1351`, `:1474`, `:1695-1706` |
| **Rename study** | Manage popover rename form; All Tabs inline rename; right-click **any** tab → "Rename study"; right-click proxy → "Rename study" | `:1300-1321`, `:1412-1442`, `:1674-1679`, `:1689-1694` |
| **Close study** | Manage popover "Close study"; All Tabs "Close"; right-click **proxy only** → "Close study"; Delete/Backspace on a focused proxy | `:1352-1363`, `:1475-1486`, `:1707-1716`, `:821-825` |
| **Move tab between studies** | All Tabs row "Move" menu (only when `groups.length > 1`); right-click tab → "Move to study…" | `:1538-1563`, `:1655-1673` |
| **Reorder tab** | pointer drag inside its own group (never crosses groups); All Tabs row "Order" menu | `:746-790` + `:153-168`, `:1516-1537` |
| **Reorder study** | Manage popover "Order"; All Tabs group "Order" | `:1322-1344`, `:1446-1467` |
| **Create study** | inline `+` / double-click empty strip / right-click empty → "Open new tab" → **all three open the palette**, then palette row 4 | `:1175`, `:854`, `:1727` → §4 below |
| **Switch study** | rail switcher only | `app.tsx:2103-2123` |

### How a reader collapses an expanded study from the strip

**Only by clicking the tab they are already on.** Nothing draws it, nothing names it, and the right-click menu on an expanded study's tab (`:1082-1087`) resolves to `{ kind: "tab" }`, whose menu is Close / Close others / Duplicate / Move to study / Rename study — **no Collapse item**. `{ kind: "group" }` (the menu that *does* carry Collapse) is reachable only from a **collapsed proxy**, so the strip's collapse menu is only available once you are already collapsed. The retired kicker was the element that carried both `aria-label="Collapse study {label}"` and the group context menu (`git show ae49372` — removed `<button className="scripture-workspace-group-tab" aria-label={\`Collapse study ${groupLabel}\`} onContextMenu={... kind: "group" ...}>`).

**Worse: collapse and expand are pointer-only.** `handleTabKeyDown` intercepts Enter/Space, calls `event.preventDefault()` and routes straight to `handleSelectTab` (`:828-832`), which suppresses the synthesized click — so the `onClick` collapse branch (`:1075`) and expand branch (`:1049`) are unreachable from the keyboard. The `byKeyboard = event.detail === 0` logic at `:1029` is dead code for tabs. Enter on the already-active tab reaches `selectWorkspaceTab`, which early-returns at `app.tsx:1271-1273` and does nothing.

### Is "Manage" still coherent?

**Yes — it is now load-bearing, and simultaneously incoherent with the stated rationale.**

Load-bearing: it is the *only* keyboard-reachable collapse/expand, the only non-right-click rename, and the only place the current study's name appears in the strip (`:1206-1232`).

Incoherent: the commit rationale was "a label among the tabs spends horizontal space permanently… and a strip truncates the name at exactly the moment the name is what is being read." That label is **still in the strip**, still permanent, and still truncating — `.scripture-workspace-active-group { max-width: 132px; text-overflow: ellipsis }` (`styles.css:2054-2069`). And it renders a **different string** from the rail for the same study: `studyWorkspaceGroupLabel()` yields a derived reference like "Acts 19" (`studyWorkspace.ts:1991-2002`) while the rail hard-codes `"This study"` (`app.tsx:1910`). Two names for one study, on screen at once.

The premium contract's claim `"no element in the strip stands for a study"` (`study-workspace-tabs-premium-contract.test.ts:459-460`) passes only because its regex looks for `scripture-workspace-group-tab|scripture-workspace-group-head` and not `scripture-workspace-active-group`.

## 2. RAIL SWITCHER DEFECTS

Markup `app.tsx:1901-1916` + `2103-2123`; styles `rail.css:495-590`.

1. **Duplicates: yes, and it is the default case.** `label: group.label.kind === "custom" ? group.label.value : "This study"` (`app.tsx:1910`). Two automatic groups render two identical rows, "This study / n" twice. This is the *primary* path to a second study: `startStudyFromCurrentCanvas` creates the group with `label: { kind: "automatic" }` (`studyWorkspace.ts:482`) and only *offers* naming afterward via `openWorkspaceGroupNamingAfterCommit`; dismiss the popover and you have two unnamed studies. The switcher only renders at `>= 2` studies (`app.tsx:2103`) — i.e. it only exists in the state where it is ambiguous. Every other surface (proxy tab, Manage button, All Tabs headings, "Move to study…" entries) uses the disambiguating derived label; the switcher is the one surface that discards it, and it is the one surface whose entire job is telling studies apart.

2. **`:focus-visible` exists** — `rail.css:549-552`, `outline: 2px solid var(--accent-seal); outline-offset: 2px`. Different token from the register (`--study-gold`), but both resolve to the same hex in all four themes (`styles.css:169/195, 685/709, 873/886, 958/971`), so this is cosmetic-only.

3. **Collapsed rail (56px): hidden**, `rail.css:590` `.sidebar.collapsed .rail-studies { display: none; }` — correct. **But the narrow shell is broken.** `collapsedRail = sidebarCollapsed && !narrowShell` (`app.tsx:484`), so below 980px the `.collapsed` class is never applied. `rail.css:275-281` hides `.rail-study`, `.rail-held` and `.nav-count` at that breakpoint but **never `.rail-studies`**. The sidebar becomes a 56px-tall `flex-direction: row` bottom bar (`styles.css:20514-20525`) with header/spacer/footer hidden — the switcher `<section>` (with its 24px top margin and a vertical `<ul>`) survives as a flex sibling of `.sidebar-nav`, stealing width from the five nav items inside a 56px bar. Uncaught by any test.

4. **`aria-current`: technically valid, semantically weak.** `aria-current={study.current || undefined}` renders `aria-current="true"` (`app.tsx:2112`). Not wrong, but the same state is already expressed as `aria-selected` on the strip's tablist, so two selection models describe one `activeTabId`. Note also `<section aria-label="Studies">` + a `<p>` reading "Studies" (`:2104-2105`) — the name is announced twice and the visible heading is not a heading element.

5. **Clicking it: the current row is a dead button, and the non-current rows contradict their own doc comment.**
   - Current row → `selectWorkspaceTab(activeTabId)` → early return at `app.tsx:1271-1273`. Nothing happens, while `cursor: pointer` and a hover fill (`rail.css:540, 544-547`) advertise otherwise.
   - Non-current row → `landing = tabs[0]`, the **first** tab (`app.tsx:1905-1907`). The comment three lines above says *"Selecting a study lands on the tab it was last on rather than its first: a study you come back to should open where you left it"* (`app.tsx:1898-1900`). The code does the exact opposite. `group.lastActiveTabId` exists and is maintained (`studyWorkspace.ts:504-506`) and is never read here. The only branch that honours "where you left it" is the one where you are already there.
   - **If the target study is collapsed, it stays collapsed.** `activateStudyWorkspaceTab` (`studyWorkspace.ts:496-510`) does not expand. The strip still shows one proxy tab with the same group-name label; only `aria-selected` moves.
   - **If everything is expanded (the default), the strip does not change at all** except which tab is filled. Both studies' tabs remain concatenated in one strip, nothing collapses, nothing scrolls into view beyond the newly-selected tab. The switcher's visible effect is a canvas change plus one tab's fill.

## 3. DEAD CODE / ORPHANS

- **`.scripture-workspace-reopen`** — 8 CSS rules (`styles.css:1692, 2045, 2175, 2181, 2186, 2249, 2912, 2944`), **no JSX renders this class**. Fully orphaned. It is also named in the premium test's "sized as one family" regex (`study-workspace-tabs-premium-contract.test.ts:539`), so the selector cannot be deleted without editing the test.
- **`.scripture-workspace-open` base rule** (`styles.css:2104-2110`: `gap: 5px; padding: 0 8px; font: 500 11px/1`) — every declaration is overridden by `.is-inline` (`:2123-2139`), which is the only variant rendered. Same for `:2173-2174` (`> span:first-child` sizing) and `:2167-2171` (`[aria-disabled="true"]`, superseded by `[data-study-open-disabled]`).
- **`scripts/qa-study-workspace-bar.mjs:371`** — `document.querySelector("[data-study-group-tab]")` targets the retired kicker; it feeds `groupVisible` (`:409-413`), asserted true at `:469` (`"named group affordance is not visible"`). **This QA gate is now guaranteed to fail.** It is not part of `npm test` (needs a build), so nothing caught it.
- **`leadKickered` / `flushStart`** — see §5, the most serious orphan.
- Comment-only residue, harmless: `styles.css:2709-2714`, `register.css:199-219`, `ScriptureWorkspaceTabs.tsx:937-953, 969-972, 1120-1138`. `data-study-group-active`, `-group-mark`, `-group-rule`, `-group-bracket` appear **only** inside comments — verified by grep across `src/` and `scripts/`.
- **`onToggleGroup` is not orphaned** — 5 live call sites (`:1050, 1076, 1350, 1473, 1704`), though two of them (`:1050, :1076`) are pointer-only per §1.
- `.rail-study-detail` (`rail.css:238-246`) renders nothing — pre-existing and documented in the sheet, not from today.
- **Sweep hole:** `actions-cluster-position-contract.test.ts`'s `SELECTION_KEY` knows `.is-selected|.is-active|.is-focused|.is-attended|.selected|.active` but **not `.is-current`**, which is the state class both new rail blocks use (`rail.css:557, 584, 225`). No violation today (colour only), but the test's own comment says an unknown state key "is a hole in the sweep, not a passing test."

## 4. THE NEW-TAB PLUS

- **Renders** between the `role="tablist"` viewport and the actions toolbar — `ScriptureWorkspaceTabs.tsx:1165-1179`, class `scripture-workspace-open is-inline`, glyph-only, `aria-label="Open a new study tab"`. Outside the tablist, correctly.
- **`onNewResearch` creates nothing.** `ScripturePage.tsx:4676` → `onOpenResearchPalette ?? onOpenCommandPalette` → `app.tsx:935-940` `openStudyTabCommandPalette`, which just opens the command palette in `mode: "open-study-tab"`. Same handler on double-click of empty strip (`:854`) and the empty-space context menu (`:1727`).
- **A study *can* be created from the strip, but only through the palette**, two steps deep and fourth of four rows: `studyTabOpenChoices` row `start-study` "Start and name a new study" → `onStartStudy` → `startStudyFromCurrentCanvas` (`CommandPalette.tsx:65-69, 1006`; `app.tsx:1059-1091, 2303`). There is no direct study-creation control anywhere in the strip or the rail.
- **Naming defects on an icon-only control:** the accessible name promises "Open a new study tab" and the click opens a modal search dialog. The tooltip conflates units — `STUDY_WORKSPACE_TAB_LIMIT = 64` is a *tab* cap (`studyWorkspace.ts:227`) but the copy reads `All 64 studies open` / `${totalTabs} of 64 studies open` (`:866-870`).
- **Geometry is 1px off the strip.** Bar content box is 30px (`height: var(--frame-top)` 40 − `padding-top: var(--page-inset)` 10; `styles.css:2043-2054` tokens at `285-299`). The plus's margin box is `height: 28px` + `margin-bottom: 3px` = **31px** (`styles.css:2130-2133`), so with `align-self: flex-end` its top edge sits 1px above every tab top and overhangs into the drag band. Both tests assert the pieces (`premium:157-160` checks 28/28/flex-end; `actions-cluster:164` checks `margin: 0 auto 3px 4px`) and neither checks the sum.
- **The "against the last tab" claim only holds on a non-overflowing strip.** The plus is *outside* the scrolling viewport, so once the strip overflows it sits at the viewport's right edge — against the 36px scroll fade, not against the last tab, and it does not travel with the tabs.

## 5. REGRESSIONS THE TESTS DID NOT CATCH

**a) Flush-start is dead — the single most consequential defect.** `ScriptureWorkspaceTabs.tsx:892-894` is **byte-identical** to `ae49372^` (verified by diff):

```
const leadKickered = leadGroup ? !leadGroup.group.collapsed : false;
const flushStart = activeRegisterIndex === 0 && !leadKickered;
```

The guard existed *because a kicker stood in front of the first tab*. The kicker is gone; the guard is not. For the default state — one expanded lead study — `leadKickered` is `true`, so `flushStart` is permanently `false` and `data-flush-start` is never emitted. The first tab therefore never squares the page's top-left corner and never drops its start-side fillet margin (`register.css:27-30`). This is the half of B·2 case 2 the owner explicitly *kept* when ruling out flush-end, and it now only fires when the leading study is collapsed. `study-workspace-tabs-premium-contract.test.ts:370-371` asserts both stale expressions verbatim, with a justifying comment about "the group's kicker is a real object at the head of the strip" — so the test locks the bug in and documents a device that no longer exists.

**b) Collapse/expand became pointer-only and unadvertised.** §1. The strip's only collapse gesture has no label, no cursor, no menu item, and no keyboard equivalent; the group context menu that carries "Collapse study" requires you to already be collapsed. `scripture-workspace-strip-interactions-contract.test.ts:165-235` is titled *"collapsing a study in the strip has an inverse in the strip"* and asserts the **source text** of both branches (`:207, :214`) — text that the keyboard path never executes.

**c) Two names for one study, simultaneously visible.** "Acts 19" in the actions cluster, "This study" in the rail. §1/§2.1.

**d) Saving: the a11y claim is contradicted by a rule that was not removed.** `styles.css:2219-2229` clips `.is-saving` to 1×1 and the commit message asserts "the text [is] still in the accessibility tree" — but `styles.css:2199` still reads `.scripture-workspace-persistence:not(.is-saving):not(.is-failed) { display: none; }`. The `role="status" aria-live="polite"` region (`ScriptureWorkspaceTabs.tsx:1182-1187`) is therefore **removed from the a11y tree between every save and re-inserted on the next one** — the exact condition the commit cites as the reason not to use `display: none`. Either the announcement does not fire (claim false) or it fires on every one of the "many times a minute" saves the same commit describes (worse than the flicker removed). The idle branch's `<span className="sr-only">Tabs saved</span>` (`:1204`) is inert markup inside a `display: none` parent. No test covers any of this.

**e) Two stacked 9px-mono kickers in the rail.** `.rail-studies` ("STUDIES") at `app.tsx:2104-2105` and `.rail-study` (the study block, kicker = the custom name or "This study") at `:2125-2126`, both `margin-top: 24px` (`rail.css:171, 516`). When the active study is custom-named the block's kicker repeats the switcher's current row verbatim; when it is automatic, the rail reads "STUDIES / This study · n / This study · n" then "THIS STUDY" as a section head.

**f) `.rail-studies` in the 56px bottom bar.** §2.3.

**g) `qa:study-workspace-bar` will assert-fail.** §3.

All four named unit-test files pass (35/35, `node --import tsx --test`). Every defect above is invisible to them because the contracts assert source text and CSS declarations rather than rendered geometry, computed reachability, or the values the expressions produce.