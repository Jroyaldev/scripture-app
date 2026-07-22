# D9 — Tab intent, natural gestures, and the premium strip

**Status: DONE (landed 2026-07-22)**

Landed with the decisions below. Verification: lint clean; Electron + renderer builds
clean; full suite 1005 / 976 pass / 0 fail / 29 expected ABI skips;
`qa:study-workspace-bar:run` PASS (both harness steps updated to the new contracts:
manual-activation arrows commit on Enter, and the real group-label button replaces the
old `data-study-group-label` pseudo-element); `qa:desktop-reading-control:run` PASS
(move-to-study now drives the custom menu; reopen lives in the All Tabs popover).
Implementation notes: drag-reorder maps a drop to the nearest legal move expressible by
the coarse `onReorderTab` start/left/right/end API (exact for end-stops and neighbor
swaps); the workspace bar/popovers flatten their derived materials to full alpha via
`rgb(from … r g b / 1)` because management surfaces must stay opaque over the canvas
(D8 contract) even under the translucent glass topbar tokens.

Approved decisions amending the goals below:
- Goal 1.3 (command palette ⌘+Enter branch) is DECLINED — no palette changes.
- Goal 1.2: the Overview open-in-tab affordance is hover/focus-revealed, hidden at rest.
- Goal 1.5: the VersePeek "Keep in Study" / "Open passage tab" pair is renamed to clear,
  unambiguous verbs (replacement semantics explicit), visually aligned with the new
  open-in-tab glyph.
- Goal 2.3: clicking the in-strip group label toggles collapse/expand (management moves
  to the right-click context menu), rather than opening the manage popover.
- Goal 2.6: double-click empty strip space opens a new tab; "Duplicate tab" is exposed in
  the tab context menu.
- Goal 2.7: middle-click on a collapsed group proxy becomes a no-op (individual tabs keep
  middle-click close).
- New Goal 3.10: the strip's scroll-edge indicators (inset shadow/blur at either end
  during trackpad slide) are overpowering — replace with subtle clean fades and audit the
  bar's effects overall for calm.

Scope: desktop only. The Study workspace tab system from D8 works, but three audits
(intent map, gesture inventory, premium critique — 2026-07-22) show it falls short of the
brief in three ways: users can silently mutate the current tab when they meant to open a
new one; natural desktop gestures land on dead affordances; and native browser chrome
leaks through the "premium minimalist" surface. No mobile work. No new feature surface —
this task makes the existing one predictable and finished.

---

## Goal 1 — One predictable open-vs-mutate contract everywhere

The rule already exists ("plain = act in this tab, modifier = branch to a new tab") and is
correctly wired on chapter arrows and the passage picker via `passageTabOpenIntent`
(`ScripturePage.tsx:2047,2065`). Three surfaces violate it; fix them by reusing the same
pattern, not inventing a new one.

1. **Cross-reference rows branch on modifier.** Every cross-ref activation site —
   Overview "Scripture" rows (`LivingMargin.tsx:1609`), Connections list rows
   (`:1271,1299`), note cross-refs (`:1515`), entity opening-context (`:739`) — honors
   ⌘/Ctrl-click and middle-click (`onAuxClick`) to open a passage tab instead of mutating
   the current one. Plain click keeps mutating (recoverable via back, as today).
2. **Overview rows get the same inline "Passage tab" affordance** the Connections and
   note lists already have (`:1307,:746`); `OverviewPanel` currently isn't passed
   `onOpenPassageTab` at all.
3. **Command palette scripture results branch on ⌘+Enter / ⌘-click.** Today meta/ctrl are
   discarded (`CommandPalette.tsx:329`) and Enter always mutates (`:425`), while entity
   results in the same palette always open a new tab (`:448`) — same UI, opposite
   behavior. Plain Enter keeps today's defaults (scripture mutates, entity opens/focuses a
   tab); ⌘+Enter and ⌘-click open a scripture result in a new passage tab.
4. **Discoverability:** `ShortcutsOverlay.tsx` documents the modifier-branch gesture as
   applying to cross-references and palette results (today `:13` covers only
   chapters/passages), and documents the existing entity branch gesture
   (`LivingMargin.tsx:90`), middle-click-close, and Delete/Backspace-close on the strip.
5. **VersePeek "Keep in Study" copy states what it does** — it replaces the current tab's
   kept margin scope (`VersePeek.tsx:184`); the label/tooltip must say "replace"
   semantics so it can't read as "pin/new."

Acceptance: from a passage tab with a scrolled canvas, ⌘-click on any cross-ref row and
on a palette scripture hit leaves the current tab untouched and opens/focuses the correct
passage tab; plain click still mutates and back restores.

## Goal 2 — The strip answers what desktop users actually try

From the gesture inventory. The strip must respond to first-instinct gestures instead of
routing everything through the `•••` popover.

1. **Drag-to-reorder tabs** (pointer-based, wired to the existing `onReorderTab`); the
   popover `Order…` controls remain as the keyboard path.
2. **Right-click context menu** on a tab, a group, and empty strip space, reusing existing
   handlers only: Close, Close others in group, Rename study, Move to study, Open new tab.
   No new capabilities — a menu over what already exists.
3. **The in-strip group label becomes a real button.** Today it is a non-interactive CSS
   `::before` (`ScriptureWorkspaceTabs.tsx:461`, `styles.css:1080-1091`). Click opens the
   group-manage popover for THAT group (not just the active one); double-click enters
   inline rename; it carries a full-name tooltip when truncated.
4. **Arrow keys use manual activation.** Roving focus moves on ←/→; the workspace
   transition commits only on Enter/Space (`ScriptureWorkspaceTabs.tsx:406-413` currently
   activates per keystroke, which can pop decision dialogs on intermediate tabs).
5. **Vertical wheel scrolls the strip** when it overflows (`deltaY` → `scrollLeft` on the
   viewport, `styles.css:1023`).
6. **Double-click empty strip space opens a new tab** (the `+ Open` path).
7. **Middle-click on a collapsed group proxy no longer silently closes the whole group**
   (`ScriptureWorkspaceTabs.tsx:379-389`) — it closes only via the explicit group-close
   affordance with its existing decision flow.
8. **Recently closed is a list, not a single slot.** Ten items are retained
   (`studyWorkspace.ts:229`) but only `at(-1)` is reopenable
   (`ScriptureWorkspaceTabs.tsx:199`); the overflow popover lists all ten.

Acceptance: each of the eight gestures does the stated thing in a component contract test;
one real-Electron scenario covers drag-reorder + context-menu close + group-label rename.

## Goal 3 — Premium material: nothing native leaks through

From the premium critique. The strip's bones are right; these are the "bolted-on" tells.

1. **No native `<select>` in the strip's popovers.** The four `Order…`/`Move…` selects
   (`ScriptureWorkspaceTabs.tsx:640,753,803,816`) become styled menus on the existing
   `Popover` primitive. (Drag-reorder from Goal 2 removes most need for `Order…`.)
2. **One glyph system.** Replace the five unicode glyphs — caret `⌄` (`:551`), reopen `↶`
   (`:575`), overflow `•••` (`:597`), search `⌕` (`:697`), plus `+` (`:563`) — with
   stroke SVGs matching the existing `PassageGlyph`/`CloseGlyph` convention
   (stroke-width 1.1–1.4, `currentColor`); delete the baseline hacks (`styles.css:1293`).
3. **App tooltips, not `title=`.** The ~14 native `title` attributes become the shared
   `<Tooltip>` (`.control-tooltip`) used by the toolbar one row above; keep `aria-label`s.
4. **One surface story.** The bar's background becomes a deliberate derivative of
   `--bg-topbar` (or adopts it) instead of the unrelated `#F7F1E6`
   (`styles.css:1007` vs `:11`); workspace popovers drop their `--workspace-active-bg`
   override (`:1363`) and inherit the shared `--bg-float` panel material; the overflow
   list gets the app's thin scrollbar treatment (`:1519` vs `:642-667`).
5. **Selection carries the app's single accent.** The selected tab's 2px indicator tints
   `var(--study-gold)` (today `--text-secondary`, `styles.css:1142`), matching how every
   other surface marks its active item; update the intentional-neutral comment
   (`styles.css:991`). Gold stays selection-only.
6. **One rhythm.** Font weights snap to 500/600 (no 550/560/650); all `5px` radii become
   `var(--radius-sm)`; interactive controls share one height with padding-grown hit areas
   (today 30/28/24px stacked in one 38px bar).
7. **Symmetric motion.** Closing a tab gets a brief width/opacity collapse matched to the
   150ms entrance (which itself uses the shared transition token instead of hardcoded
   `ease-out`); reduced-motion is respected.
8. **Calmer actions cluster.** Reopen (`↶`) moves inside the `•••` menu (it already exists
   there, `:687`); the cluster at rest is active-group chip + `+` + `•••`.
9. **Capacity is a gauge, not a cliff.** The `+ Open` control disables at the 64-tab cap
   with a count in its tooltip near the cap; the `move-entity-context` capacity check runs
   before its confirmation dialog, never after (`studyWorkspace.ts:1186-1189`).

Acceptance: zero `<select>`, zero `title=`, zero unicode control glyphs in
`ScriptureWorkspaceTabs.tsx`; one grep-verifiable pass. Visual pass in the real app across
Paper + one dark theme only.

---

## Verification (deliberately lean)

- Focused unit/contract tests only for new logic: cross-ref/palette modifier branching,
  manual-activation keyboard reducer, drag-reorder ordering, context-menu action routing,
  recently-closed list. No theme sweep, no viewport matrix, no route-digest rerun.
- One extended real-Electron QA scenario (`qa:study-workspace-bar`) covering: ⌘-click a
  cross-ref (current tab untouched), drag-reorder, right-click close, group-label rename,
  reopen from the recently-closed list.
- `lint`, both builds, full unit suite once at the end.

Out of scope: mobile/compact expansion, tab groups beyond current semantics, type-ahead
jump, Shift-click multi-select, per-tab dirty indicators (needs a product decision on
what "dirty" means per tab), A14/A19.
