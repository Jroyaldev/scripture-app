# TODO — Smart Shapes app port (audit of lab vs. actual app)

> Baseline audit date: 2026-07-20, branch `codex/smart-shapes` @ `0345781`.
> The lab (`lab/shapes.html`) is visually approved: bracket grammar (C0.5),
> active-connection card, unified kinds+highlights menu, merged painted
> emphasis, runs exactly on the underline. At that baseline, none of it existed
> in the app; the current worktree closure state is recorded below.
> Items ordered by dependency. Keep every visual contract; the user rejects
> deviations fast (see `lab/PROMPT-loom.md` final section + the memory note
> "loom-bracket-grammar-aesthetic").

## Audit 2026-07-20 — controlling truth (implementation checkpoint)

A large dirty/untracked worktree now carries the implementation-complete app
port. P0, exact Backbone-v2 phrase anchors and their frozen catalog artifacts,
the first-party authored-event boundary, the Living Margin card, merged paint,
block-local reflow, and all four P2 authoring surfaces are closed in code. The
checkpoint is not yet an approved release: fresh post-refinement Radial/Dock and
first reading-interaction Electron runs plus refreshed final visual proof remain
pending because the external GUI launch quota was exhausted. SVG export is
intentionally deferred rather than silently treated as part of the port. The
closure work below is landed together on `codex/smart-shapes`; the remaining
gates are release approval work, not missing checkpoint code.

**Approved contract amendments (preserve, do not revert):**
- Four selectable marking systems (Palette / Pen Rail / Radial / Dock)
  replace the single unified menu.
- The connection card lives in-flow in Living Margin.

**Per-gate truth:**

| Gate | State |
|---|---|
| P0 engine | **Checkpoint gate closed:** strict TS exists at `src/core/annotations/route-engine.ts`; all three frozen suites import it directly and pass **36/36** unchanged, including the frozen SHA geometry goldens. |
| P0 overlay | **Worktree gate closed:** a persistent connector SVG measures every rectangle from its own painted `getBoundingClientRect()`. Real loom air is reserved inside the clipped reading stage; `HighlightUnderlay` and `ConnectionUnderlay` share one ResizeObserver/window/fonts lifecycle, including cache invalidation after font settlement. |
| P0 alignment | **Worktree gate closed:** `npm run qa:connections` passed the real isolated Electron renderer at all four themes × 640/860/1280px. Raw maximum centerline/frame delta was **0.0050px** (reported **0.0px**); the selected target remained routable, one user-held companion stayed explicit without a centerline, and the reading canvas had zero horizontal overflow. |
| P1 anchors | **Worktree gate closed:** connection v2 stores exact phrase occurrences in translation-free Backbone coordinates, including multi-verse selections. Frozen occurrence catalogs and alignment/refusal artifacts project package text into canonical coordinates and fail closed on ambiguous, missing, mismatched, or stale locators instead of degrading silently to invented exact paint. Legacy v1 records remain readable without weakening v2 writes. |
| P1 durability | **Worktree gate closed:** the first-party `UserMutationBroker` and `RevisionStore.commitAppend` own explicit-intent commands, crash-recoverable append, atomic rebuildable-SQLite projection, optimistic active-event versions, exact command/base Retry, and authenticated history. Observation plus created/updated timestamps are versioned event data, not renderer-local state. Current verification is **690 tests total / 661 pass / 29 expected Electron-ABI skips**, native Electron-as-Node **89/89**, and `qa:connection-broker` proves the four-event causal chain, one refused stale sibling, and **3,202 append-only bytes**. |
| P2 card | **Worktree gate closed:** the in-flow Living Margin card follows the approved `.ccard` hierarchy, keeps one flat 12×2 hue tick, uses neutral actions and keyboard-only gold focus, reports here/above/below, separates focus from ordered held state, and coexists with Study in one scroll owner. Its quiet inline observation is durable through the same broker/RevisionStore event boundary, with explicit dirty/saved/optional feedback and blur or Cmd/Ctrl-Enter save; it is no longer a NoteCapture stand-in. The existing 12/12 interaction gate remains the last completed live matrix; the refined final card paint still needs a fresh proof frame once GUI launch is available. |
| P2 emphasis | **Worktree gate closed:** exact active-package phrase rectangles become one stitched wash per anchor and one continuous underline per rendered line. Dormant records expose only quiet exact presence paint and a tick, with zero route/contact/hit ink. Preview brings the member words and tick forward but still paints no line; only selection paints one bracket, hit target, and focal veil. While one relationship owns focus, ordered held companions retain a quiet wash/underline and coincident lines step by 3px; after focus dismissal, every held relationship returns to quiet word presence plus ticks with zero line/contact/hit/card artifacts. Shared dormant overlap resolves to neutral gold. Package-mismatched or unrecoverable locators never receive fake exact-word paint. The completed paint gate passed 12/12 theme-width cells, reduced motion, forced colors, and 200 warm switches with zero Range reads and stable DOM/listener counts. |
| P2 reading interactions | **Worktree source/static gate closed; fresh live matrix pending:** ordinary click and Shift-click own Study scope, a real noncollapsed text-origin drag owns marking even when mouseup lands in gutter/loom air, exact connected-word clicks open that relationship, overlaps expose a neutral modal chooser bounded to its reading stage, and outside click or Escape dismisses the visible shape without invoking Release or selecting a held fallback. The chooser shrinks at 390px, scrolls long candidate lists under a fixed header, takes initial focus, supports Home/End/arrow roving, and restores its origin; stale candidates cannot resurrect deleted records. Pointer activation keeps focus in Scripture; keyboard-origin card activation moves focus into the Living Margin inspector. Enter/Space select Study, `M` deliberately marks a whole verse, plain Left/Right traverse chapters, and Tab/Shift-Tab cycle Living Margin lenses. The Escape ladder closes chooser, then selected shape/card, then Focus mode; marking surfaces now consume their own Escape in capture before Focus can exit, and Radial's outside shield stays mounted through the completing click. At 390px the Living Margin becomes a full-width in-flow lower pane instead of covering Scripture, with both panes retaining at least 300px of usable height. Margin ticks keep full 24×44 hybrid-touch targets. The pure lane planner groups natural local collisions within their own desired span, leaves distant singles unmoved, exposes truthful chooser-only `aria-expanded`, and never chooses an aggregate member arbitrarily. Tick activation only opens or reaffirms; the labelled Living Margin Release action is the sole way to remove a hold. The permanent `qa:reading-interactions` gate seeds 14 real v2 records and fingerprints authored JSONL byte-for-byte. Its eight Palette/Rail/Radial/Dock × 390/860 cells check dispatch-point ownership, pane non-overlap, click/Shift-click/drag, direct-or-grouped tick activation, exact-word activation, modal keyboard sequences, the ordered Escape ladder, bounded dense choices, selected-only paint, and explicit Release. A post-matrix coarse-pointer phase uses the unmodified production chapter geometry, reads the live `::before` target expansion, hit-tests both expanded edges of every control, proves same-side effective intervals do not overlap and every durable id is represented exactly once, verifies neutral chooser membership and accessibility state, then requires one held route/card before Release. CDP protocol errors and bounded Electron cleanup now fail explicitly. The harness is implemented, syntax/build checked, and statically contracted, but has not been launched because the external GUI quota is exhausted. |
| P2 surfaces | **Palette, Pen Rail, Radial, and Dock are closed in implementation.** Each retains its distinct physical model, the full six-relationship/five-wash content contract, responsive stage-relative placement, neutral one-hue material, exact authoring emphasis, real brokered mutations/retry, keyboard ownership, reduced-motion/forced-color behavior, and dormant zero-line versus selected one-bracket semantics. Palette and Rail retain their recorded live matrices; current focused static surface proof is **23/23**. Final source-certain polish removes Palette/Dock pigment gloss, keeps Glass pointers on the same translucent material, removes repeated Dock labels, gives Radial sheet-specific guidance, and uses one placement-variable Popover entrance animation so a measured flip cannot replay. Radial's last full live matrix predates the final narrow-sheet flattening and desktop depth subtraction. Dock's corrected stage-derived coarse-target phase and motion phase both passed live, but its whole run predates the final stacked-row refinement. Rerun `npm run qa:marking-radial` and `npm run qa:marking-dock`, then refresh final frames, when GUI launch is available. |
| P3 | **Implementation cleanup closed:** state-only paint uses cached geometry; genuine reflow is block-local; font settlement invalidates glyph geometry globally; selected-only hit targets and explicit held ticks remain enforced. The permanent Route Lab digest gate now checks C0.3 `8b2dcd67ecc6cdbee5ebabf05810ae4f55ba2e321d7000719fc1f9012b1ca1cb` and C0.4 `3b01cd13a8db1c6b360e956622be1610de416a63ab745bde4aecf3967c5f6b7f` without a write/rebaseline mode. The live browser oracle passed all 5,719 states / 11,438 deterministic renders at those exact hashes. Lab resize and dormant-planner decisions are recorded below. SVG export is intentionally deferred pending a versioned, privacy-aware faithful-versus-schematic export contract. |

`STATUS.md` ("Production marking surfaces" row) must describe this as an
implementation checkpoint whose final live approval
still awaits the post-refinement Radial/Dock reruns and refreshed card proof.

## P0 — foundations

1. **Strict TS engine port → `src/core/annotations/route-engine.ts`.**
   Source: `lab/route-engine.js` (pure, no DOM — port is mechanical but must
   be byte-faithful in behavior). Port the three test files
   (`tests/route-engine-{claims,bidirectional,sections}.test.ts`) to import
   from `src/core`; keep golden digests identical (they encode the approved
   silhouettes). Keep `_internals` export for tests. No `Date.now`/random.
   **Worktree gate closed 2026-07-20:** all three frozen suites import the
   strict core engine directly and pass 36/36 without a golden rebaseline.
   This is committed with the port checkpoint.

2. **Shared overlay boundary in the renderer.** `ScripturePage.tsx` owns the
   verse canvas; `LivingMargin` is a sibling panel — there is NO single
   coordinate space spanning canvas + margins and NO reserved loom air.
   Needed: one absolutely-positioned connector overlay whose own
   `getBoundingClientRect` is the coordinate base for BOTH measurement and
   paint (lab lesson, commit `27743d4`: measuring against a parent border
   box caused a permanent 1px drop). Reserve left/right margin air without
   invading LivingMargin. Reuse `HighlightUnderlay.tsx`'s lifecycle
   (ResizeObserver + fonts.ready re-measure, lines ~27/297/306) — do NOT
   invent a second lifecycle.
   **Worktree gate closed 2026-07-20:** the persistent connector SVG is its
   own sole coordinate base. CSS reserves genuine loom air inside the reading
   stage without changing prose measure or entering Living Margin. Both
   underlays now use `useUnderlayMeasurementLifecycle`; it observes the real
   sizing owners, coalesces work through rAF, and invalidates on `fonts.ready`
   and `loadingdone`. The hook attaches in a passive effect so parent-owned
   refs exist before observation; live resize proved SVG rect and viewBox stay
   identical after reflow.

3. **Underline geometry contract in the app.** Lab invariants that MUST be
   re-derived for the app's own underline rendering (do not copy blindly):
   - pin y = drawn underline CENTER; lab formula cancels font ink-slack
     (`lab/lab.js` `underlinePinDy` near `planOne`, ~2600) — the app must
     compute its own equivalent from however it paints phrase underlines;
   - engine `UNDERLINE_STRIP = 2.25` assumes ~1.5px underline near box
     bottom; revisit against app metrics;
   - flush any font-metric caches on `fonts.ready` (lab bug: pre-webfont
     metrics poisoned fragment bottoms → width-seeming misalignment).
   **Worktree gate closed 2026-07-20:** the app derives ink slack from its
   computed font metrics, paints the underline center at raw Range bottom
   minus `0.75px`, and gives the planner `slack.bottom - 0.75px`, cancelling
   slack exactly. Quiet/selected underline widths are `1/1.5px`; quiet/
   selected routes are `1.25/1.5px`; the frozen engine collision strip stays
   `2.25px` and no digest was rebaselined. The isolated Electron matrix in
   `scripts/qa-connection-alignment.mjs` passed 12/12 cells with raw maximum
   delta `0.0050px`, reported `0.0px`, wrapped phrases, explicit held states,
   and zero horizontal overflow.

## P1 — data + domain

4. **Durable anchors.** App `AnchorRecord` is verse-level
   (`src/renderer/api.ts:211`, `src/core/indexer/types.ts:21`); lab keys are
   `{ref, phrase, occ}` resolved per translation at render. Needed: a
   connection record with 2+ exact-phrase anchors in Backbone coordinates
   (never translation tokens), plus kind, note, created/updated — through
   the broker/RevisionStore append-only event contracts (`src/core/events`,
   `src/core/annotations`). Lab persistence is localStorage
   (`shape-marks-user`) — throwaway; `lab/patterns.js` documents the
   intended closed kind vocabulary + payload draft (`shape-marks.jsonl`).
   **Worktree P1 gate closed 2026-07-20:**
   `src/host/user-mutation-broker.ts` is a separate first-party broker that
   requires explicit UI intent, serializes connection commands, and makes a
   stable command id idempotent. `RevisionStore.commitAppend` owns the
   validated, fsynced optimistic append journal before `LibraryEngine`
   projects rebuildable SQLite inside an atomic WAL transaction. Monotonic
   tickets, prepared/committed markers, exact-suffix repair, authenticated
   history, active-event versions, byte-bounded settled state, and exact
   command/base Retry semantics close the known crash, concurrency, stale-
   sibling, resurrection, and ambiguous-response holes at this boundary. The
   current full matrix is 690 tests total: 661 pass plus 29 expected Electron-
   ABI skips; Electron-as-Node runs the native SQLite path at 89/89. `npm run
   qa:connection-broker` proves an idempotent four-event causal chain, refuses
   one stale sibling, and leaves 3,202 append-only bytes. Exact-phrase v2
   anchors now store frozen occurrence identities in translation-free Backbone
   coordinates, including multi-verse selections. Frozen catalog/alignment
   artifacts project packaged text into those coordinates and refuse
   ambiguous, missing, mismatched, or stale locators. Mixed v1/v2 reads remain
   compatible while all new authored writes use v2. Observation and created/
   updated timestamps are versioned event fields through the same broker and
   RevisionStore boundary. Card and response-loss gates continue to prove that
   navigation, Escape, and Retry cannot duplicate or silently replace a frozen
   command.

5. **Highlight unification.** The lab's menu-created highlights
   (`{type:"highlight", color, key}` in the same lab store) must become a
   path into the app's EXISTING highlight system (HighlightUnderlay +
   highlight records), not a second store. The five-color vocabulary
   (`HIGHLIGHT_COLORS` in `lab/patterns.js`) and per-atmosphere wash
   composition (`--hl-*` in `lab/lab.css`; note the dark-theme
   re-declaration of the composed color-mix vars — CSS cascade gotcha) are
   the approved design.

6. **Sections stay dormant.** `ChapterData` has no semantic sections /
   hard-clear gaps; ship with `sectionRouting` disabled. NEVER infer
   sections from layout. Handoff geometry is already engine-complete.

## P2 — UI port

7. **`<ConnectionCard>`.** Port `.ccard` (lab/lab.js ~3020-3200, lab.css
   `.ccard` block) 1:1: appears ONLY while a connection is held; hue in
   exactly ONE element (12×2 kind tick); title, `kind · N moments`
   (+ plain "· N more held"), observation, moment rows (tabular mono ref +
   serif phrase + small-caps here/above/below, whole row navigates), quiet
   actions. No left-edge accent bars, no colored hovers, gold focus ring
   keyboard-only. Lab tokens ARE app tokens (`design-tokens.json`).
   **Worktree visual/interaction slice landed 2026-07-20:** the card uses the
   approved typeset hierarchy in Living Margin, with one flat 12×2 hue tick,
   de-duplicated title/kind metadata, package-honest serif phrases, plain
   here/above/below state, quiet neutral actions, and no close X or red delete
   treatment. An ordered `heldConnectionIds` seam is distinct from the route
   planner's needs-space `.held` state; switching ticks retains companions and
   displays `· N more held`, while Release drops only the focused relationship.
   The card and normal Study rail now share one scroll owner at every tested
   width. At 390px the Living Margin becomes a full-width in-flow lower pane,
   with Study mounted below the inspector, the real 12px margin gutter for
   tabs, no overlap with Scripture, and at least 300px of usable height in both
   panes. `scripts/qa-connection-card.mjs`
   passes all 12 Paper/Ink/Glass/Candlelight × 640/860/1280px cells with one
   in-flow card, exact containment, pointer-clean focus, ordered held fallback,
   and no nested scroller. The observation is now a quiet inline, single-line-
   at-rest editor backed by versioned broker/RevisionStore events. It exposes
   explicit optional, dirty, and saved feedback and commits on blur or Cmd/Ctrl-
   Enter without introducing a second store. The final refined paint needs a
   fresh proof frame once GUI launch is available; the interaction and durable-
   mutation contracts are closed.

8. **Authoring surfaces.** AMENDED (see audit above): the four selectable
   systems (Palette/Rail/Radial/Dock) supersede the single unified menu —
   do not collapse them back. Still port from the lab bar: the exact
   two-vocabulary content contract (kinds / divider / 5 washes / caption)
   inside whichever system is active. Original item kept for the content
   spec: Port the selection bar (kinds row / divider /
   5 highlight swatches, caption "connect the words — or lay a wash").
   Decide fate of the external palette-host seam (`window.LAB_AUTHOR` /
   `LAB_PALETTE` hooks in lab/lab.js ~3460+; `lab/palette.html`+`.css` were
   originally added outside this session) — land, adapt, or drop before
   port; the seam is the natural adapter boundary for a React host.
   **Decision 2026-07-20:** keep those globals lab-only. Production's typed
   `MarkingSurface` props are already the React adapter boundary; no window
   global or localStorage host seam will enter the app.
   **Palette worktree gate closed 2026-07-20:** the floating Palette restores
   the approved lab hierarchy while retaining stronger app geometry. Its real
   rendered dimensions, not a 330px guess, choose above/below/sheet placement
   inside the passed reading-stage rectangle. The complete six-kind plus
   five-wash vocabulary remains simultaneous at 390px; one 11-command roving
   sequence supports arrows, Home/End, `1`–`6`, and `Shift+1`–`Shift+5`.
   Selected words appear as restrained reading-type quotation; relationship
   glyphs stay neutral at rest; pigment samples are flat; gold appears only on
   keyboard focus; and Note, Remove, Pin, Close, live definitions, and the
   pinned-tool status share one quiet material. Armed auto-apply suppresses the
   menu before paint, applies exactly once, and reveals the selection again if
   capture is busy or rejected. `scripts/qa-marking-palette.mjs` permanently
   covers Paper/Ink/Glass/Candlelight at 390×900, 640×900, 860×900,
   1280×900, and 860×420, plus reduced motion, forced colors, keyboard command
   semantics, pin → next phrase → put down, and 60 mount/unmount cycles. The
   recorded isolated run passed all 20 cells with stable DOM/listeners and a
   bounded second-warm-batch heap plateau. Rail, Radial, and Dock are
   judged only by their separately recorded gates below; closure is never
   inferred from the shared controller or this Palette result.
   **Pen Rail worktree gate closed 2026-07-20:** the production Rail is an
   authored four-tool instrument
   (Highlight / Connect / Note / Erase) with stage-measured side/bottom layout,
   one roving toolbar, bounded vocabulary trays, exact quotation/reference,
   neutral active chrome, one semantic hue, a visible carried-tool status, and
   cancellable context-owned focus return. Real highlight and erase mutations
   retain the exact phrase on rejection and require an explicit retry; an armed
   wash applies once to the next phrase without flashing a tray. Connection
   authoring holds exact words in the shared paint plane but cannot create a
   route, contact, hit target, tick, or durable record until Done succeeds.
   Completed dormant connections retain discoverable presence paint and a tick
   with zero lines; selecting the tick produces one bracket, merged member-word
   focus, and the Living Margin card, and releasing it removes the line again.
   `scripts/qa-marking-rail.mjs` is a permanent fresh-build gate for all four
   themes at 390×900, 640×900, 860×900, 1280×900, and 860×420. It also covers
   exact matrix completeness, last-choice reachability, keyboard ownership,
   one-shot write failures and retries, real Highlight/Note/Erase, armed
   auto-apply, draft-to-durable connection integration, reduced motion, forced
   colors, entrance-without-replay, and two representative 30-cycle warm
   batches with authored-count protection. Side layout transfers focus only
   after the measured tray becomes visible, a new selection generation cancels
   older deferred reading focus, and dormant tooltips stay inside the shell's
   scroll geometry until visibly requested. `qa:marking-rail` passes all 20
   theme/viewport cells, keyboard activation and grouped roving, real
   Highlight/Note/Erase failures and explicit Retry, armed no-flash auto-apply,
   exact authoring paint, durable Series integration, dormant zero-line and
   selected one-bracket/card states, reduced motion, forced colors,
   no-remount/no-replay motion, and 60 warm cycles with stable DOM/listeners
   and 113,604 bytes of heap growth. The dedicated response-loss gate
   separately passes one committed Series event, retained held phrases, and
   zero duplicate append. Static proof remains green: 23/23 focused contracts,
   lint, both builds, harness syntax, and diff checks.
   **Radial worktree gate closed 2026-07-20:** the production Radial now uses
   the approved collective wheel grammar without the lab's fragile synthetic
   placement assumptions. A 320px wheel self-measures its 46px commands and
   external 216px context card against the reading stage, tries legal prose-
   relative placements without covering the selected words, and falls back to
   a bounded six-column sheet at `<=640px` or `<=420px`. Relationship petals
   remain neutral at rest; pigment samples are the persistent hue; the 80px
   Mark hub and one dynamic focal field provide hierarchy without nested rings,
   accent edges, or colored halos. The dialog owns one 11-command roving path,
   exact Tab containment, Escape/scrim dismissal, reading-focus return, coarse
   targets, reduced motion, and forced-color borders for Pin, Note, and Close.
   Successful actions consume the native Range; rejected highlight/erase writes
   restore the exact Range and cancel any stale reading-focus frame before
   returning focus to Parallelism. Armed auto-apply never flashes a wheel.
   `scripts/qa-marking-radial.mjs` is the permanent fresh-build gate. It passes
   all four themes at 390x900, 640x900, 860x900, 1280x900, and 860x420; real
   pointer hit-testing; exact highlight and ordered connection locators;
   explicit one-shot retries; authoring emphasis with zero draft line artifacts;
   dormant zero-line/selected one-bracket paint plus the Living Margin card;
   same-node resize, breakpoint, and theme changes without remount or entrance
   replay; reduced motion; forced colors; and 60 mixed wheel/sheet cycles with
   stable documents, no DOM/listener growth, and a bounded second-warm-batch
   heap plateau. The sealed runtime floor is 390px; sub-352px and a full
   media/theme cross-product are not claimed by this gate.
   The final narrow-sheet refinement removes the circular nested hub and the
   bordered/shadowed help card: Pin is now a flat 44px header action and help
   rests on one quiet hairline inside the sheet's single material plane.
   Desktop keeps the wheel geometry while dropping the split ring and idle
   petal shadows, leaving one collective field and depth only on intent. These
   final CSS refinements postdate the last full live Radial run; the 23/23
   static contract and renderer build are current, while the live matrix must
   be refreshed when GUI launch is available.
   **Dock worktree gate closed 2026-07-20:** the production Dock is one
   stage-owned neutral instrument shelf that becomes a contained two-row stack
   as the reading stage narrows. Five measured roving radio modes share one
   thumb; the center exposes the complete six-relationship/five-wash vocabulary
   without accent bars, permanent relationship color, or hidden Hinge at the
   860px shelf. At constrained shelf widths the explanatory subtitle yields to
   the full vocabulary; at 390px the mode rail, exact selection context,
   existing-highlight actions, Retry/Cancel, and session copy remain contained
   with 44px coarse targets. Authoring holds exact phrases in one stitched wash
   and paints no route, underline, contact, hit target, or tick. Dormant
   connections keep discoverable emphasis and a tick but no line; selecting a
   connection brings only its words into focus, paints one clean bracket, and
   opens the shared Living Margin card without shrinking the reading stage
   below 300px or covering the Dock. Multi-member Parallelism requires explicit
   Done; binary Contrast auto-attempts at its counterpart and retains both
   phrases through explicit Retry. `scripts/qa-marking-dock.mjs` is the
   permanent fresh-build gate for Paper/Ink/Glass/Candlelight at 390x900,
   640x900, 860x900, 1280x900, and 860x420 plus pointer/keyboard mutation,
   retry, persistence, media, no-replay motion, and warm-cycle resource proof.
   After correcting the harness to derive coarse-target geometry from the
   actual Dock stage instead of the viewport, both the corrected coarse phase
   and the motion phase passed live. A final fresh all-in-one run could not be
   launched after the external GUI approval quota was exhausted. The earlier
   whole-gate result predates that harness correction and is retained only as
   historical evidence, not claimed as current full proof. Rerun the whole
   command and refresh its success frames when GUI launch is available. The
   delayed API-injection nonce race remains limited by the frozen preload
   bridge; real-pointer nonce isolation and byte-level append-log fingerprints
   remain covered. Current static closure is 23/23 focused surface contracts,
   36/36 frozen route tests with no rebaseline, 690 total tests with 661 pass
   and 29 expected Electron-ABI skips, and 89/89 native Electron-as-Node.
   `qa:connection-broker` proves the four-event idempotent causal chain, one
   refused stale sibling, and 3,202 append-only bytes. Exact v2 anchors,
   catalog/refusal artifacts, and durable observation/timestamps are closed;
   only the fresh Dock all-in-one proof and refreshed card frame hold final
   live approval.
   The final stacked-layout refinement moves transient Note/Erase actions into
   the context row, keeps the five reading modes together on their own row, and
   restores a quiet hairline between context and modes so the 390px Dock no
   longer reads as one undifferentiated icon strip.

9. **Merged painted emphasis.** Port commit `0345781`'s approach: washes +
   underlines painted from merged measured rects per anchor (continuous
   through segment boundaries/spaces/wraps; rounded only at true ends),
   spans remain interaction targets only. In-app, `.pk`-equivalent
   segmentation will come from overlapping records — same solution applies.
   **Worktree visual gate closed 2026-07-20:** `ConnectionUnderlay` owns two
   independently self-measured SVG planes. Exact active-package anchors paint
   one merged wash per anchor and one continuous underline per rendered line.
   Dormant relationships paint no route, contact, underline, or invisible hit
   target. Preview brings the member words and tick forward without painting a
   line; selection alone paints one bracket, selected hit target, and focal
   veil. While one relationship owns focus, ordered held companions retain only
   a quiet wash and underline; dismissing focus preserves their quiet word
   presence and ticks while removing every route/underline/contact/hit node. Shared
   dormant overlap is punched out of individual hues and painted once in
   neutral gold, while coincident companion underlines use deterministic 3px
   levels. Pointer preview has bounded enter/leave intent, keyboard preview is
   immediate, and reduced motion jumps to terminal paint. Cross-package or
   unrecoverable anchors remain honest passage-level fallbacks. Permanent proof
   in `scripts/qa-connection-paint.mjs` passes Paper/Ink/Glass/Candlelight at
   640/860/1280px, four reduced-motion probes, forced colors, and 200 state
   switches with zero Range reads, stable DOM/listener counts, no draw replay,
   and 100,508 bytes of second-batch retained-heap growth.

9a. **Reading-canvas interaction ownership.** A click is research, not a
    degenerate marking gesture: it selects that verse in Study and reveals the
    Living Margin. Shift-click extends the stable research range. Only a real
    noncollapsed native selection opens the chosen marking surface; `M` is the
    explicit keyboard command for whole-verse marking. A collapsed click on
    exact connected words takes priority over the surrounding verse and opens
    that relationship; coincident records require a neutral chooser instead of
    invisible cycling. Clicking unconnected Scripture completes Study and
    dismisses the visible shape in the same gesture. Clicking blank reading
    chrome or pressing Escape dismisses selected focus, routes, veil, and card
    while preserving deliberate held comparisons; only Release removes a hold.
    Pointer activation leaves focus in the reading canvas, while keyboard-origin
    activation deliberately focuses the Living Margin inspector. Global Tab /
    Shift-Tab cycle Living Margin lenses, plain Left/Right on verse rows traverse
    chapters, and local margin-tab arrows remain inside that tablist.
    **Worktree source/static gate closed 2026-07-20:** `readingInteraction.ts`
    provides deterministic intent and overlap ordering; `ConnectionUnderlay`
    reuses its cached, self-relative exact emphasis bands for pointer hit testing
    without adding DOM spans, Range reads, or pointer-catching paint;
    `ScripturePage` owns the one-transition click/drag/dismiss state machine; and
    `ConnectionCard` separates Dismiss from Release. Gesture ownership begins
    only on actual Scripture text, document mouseup commits outside releases,
    and one-task suppression consumes only the trailing drag click. The overlap
    chooser is a modal, reading-stage-bounded surface with initial focus, an
    independently scrolling list, Home/End/arrow roving, stale-candidate
    pruning, and focus restoration to the originating row. The ordered Escape
    ladder closes chooser, then selected shape/card, then Focus mode without
    invoking Release. At 390px Scripture and the Living Margin become
    non-overlapping stacked panes with at least 300px of usable height each.
    Margin ticks use a pure, executable packing contract and full hybrid-touch
    24×44 targets. Natural local collisions group within their own desired
    span, while distant singles remain unmoved; every neutral aggregate opens
    the explicit chooser and never previews or selects an arbitrary member.
    Aggregate `aria-expanded` follows the chooser rather than a selected
    member, and only the labelled card action can Release a hold. Focused
    underlay/interaction/surface/margin tests pass 72/72.
    `scripts/qa-reading-interactions.mjs` is the permanent real-CDP
    gate across Palette/Rail/Radial/Dock at 390/860px. It seeds a two-record
    unique/shared baseline plus a separate 12-record dense overlap, then covers
    native click/Shift-click/drag, dispatch-point hit ownership, unique and
    shared word activation, inside-boundary clicks, stage-contained modal
    overlap geometry, every dense candidate, Home/End/arrow roving, layered
    Escape ownership, explicit Release, exact native-selection/model agreement
    after a gutter release, zero lines after dismissal, compact pane
    non-overlap, clean renderer diagnostics, and byte-identical authored JSONL.
    A final coarse-pointer phase leaves the production chapter geometry
    unmodified, reads the live target pseudo-element, hit-tests both expanded
    edges of every control, proves all effective 44px targets remain
    non-overlapping and every durable id appears exactly once across singles or
    side-local aggregates, opens the aggregate chooser, and requires one held
    route/card before explicit Release. Protocol failures, pointer/viewport
    restoration, and bounded Electron exit are refusal gates rather than
    best-effort cleanup.
    The harness is syntax/build checked; its first live run remains pending the
    same external GUI-launch quota that blocks final Radial/Dock approval.

## P3 — known warts / cleanups (lab-side, cheap)

10. **Closed / verified:** the lab host already redraws through window resize
    and ResizeObserver paths; the app additionally shares its observer/window/
    fonts-ready lifecycle across both paint planes. No stale synthetic sizing
    path remains part of the approved port.
11. **Decision recorded:** dormant bow planners remain explicitly historical
    and unreachable reference code in the lab. Production does not import or
    expose them; pruning is optional lab housekeeping, not a port gate.
12. **Decision recorded:** the middle-shaft family remains engine-retained and
    host-disabled in both lab and app. It may return only after a separate
    bracket-grammar visual approval; no current host may enable it implicitly.
13. **Closed in-app:** per-verse glyph and anchor geometry is cached relative
    to each row. A reflowed row is remeasured; unchanged translated rows are
    reprojected after earlier-row movement without a Range scan. Font settlement
    deliberately invalidates all glyph geometry. The 40-row regression and the
    current focused underlay/interaction/surface/margin matrix passes 72/72; the 200-state
    switch gate still records zero Range reads and stable DOM/listener counts.
14. **Intentionally deferred:** the lab `exportCard` is a schematic package-
    text illustration with fixed colors, approximate underline lengths, and no
    Backbone-v2 identity. Porting it now would misrepresent durable authored
    data. Revisit only with a versioned user-export contract covering schematic
    versus faithful output, fonts, privacy, and download ownership.
15. **Closed as a permanent refusal gate:** `npm run qa:route-lab-digests`
    serves the lab in an isolated headless browser, waits for fonts, and fails
    unless C0.3 is exactly
    `8b2dcd67ecc6cdbee5ebabf05810ae4f55ba2e321d7000719fc1f9012b1ca1cb`
    and C0.4 is exactly
    `3b01cd13a8db1c6b360e956622be1610de416a63ab745bde4aecf3967c5f6b7f`.
    It has no write or silent-rebaseline mode; an intentional engine change
    must update the frozen baseline explicitly after both rendered suites run.
    The in-app live oracle passed C0.3 at 4,515 states and C0.4 at 5,719 unique
    states / 11,438 deterministic renders with those exact hashes and no
    browser-reported failure.

## Acceptance for the app port (mirror of the lab gates)

- Engine suites green from `src/core` imports; goldens byte-identical.
- A focused held connection on the real reading canvas draws one bracket with
  runs exactly on the app's merged underline (reported 0.0px at three widths);
  dormant and companion connections never paint centerlines or invisible hits.
- Rest has zero route/underline/contact/hit nodes while exact anchors remain
  discoverable through merged presence paint and ticks; focus restores member
  words, and only while that focus is visible may held companions retain their
  quiet merged underline.
- Preview wakes only the member words and tick; a route, selected hit target,
  and focal veil exist only while the connection is selected.
- Held/needs-space is an explicit affordance; nothing silently disappears.
- Exact Backbone-v2 occurrence anchors, frozen catalog alignment/refusal, and
  durable observation/timestamps survive package changes and mixed v1/v2 reads.
- All four app themes; authoring surfaces down to 390px/short viewports;
  640–1280 underline alignment; keyboard access; ordinary, reduced-motion, and
  forced-colors paint states.
- Genuine reflow rescans only affected rows; frozen C0.3/C0.4 digests refuse
  accidental route-engine drift.
- All mutations through broker/RevisionStore events; no localStorage.
- Ordinary click/Shift-click select Study; real drag opens marking; exact-word
  click opens a connection; overlap requires an explicit chooser; and one
  outside click or Escape dismisses visible focus without releasing held state.
- Final live approval requires fresh post-refinement Radial and Dock Electron
  runs, the new reading-interaction matrix, and refreshed refined-card proof
  frames once GUI launch is available.
