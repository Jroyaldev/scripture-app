# TODO — Smart Shapes app port (audit of lab vs. actual app)

> Audit date: 2026-07-20, branch `codex/smart-shapes` @ `0345781`.
> The lab (`lab/shapes.html`) is visually approved: bracket grammar (C0.5),
> active-connection card, unified kinds+highlights menu, merged painted
> emphasis, runs exactly on the underline. NONE of it exists in the app yet.
> Items ordered by dependency. Keep every visual contract; the user rejects
> deviations fast (see `lab/PROMPT-loom.md` final section + the memory note
> "loom-bracket-grammar-aesthetic").

## P0 — foundations

1. **Strict TS engine port → `src/core/patterns/route-engine.ts`.**
   Source: `lab/route-engine.js` (pure, no DOM — port is mechanical but must
   be byte-faithful in behavior). Port the three test files
   (`tests/route-engine-{claims,bidirectional,sections}.test.ts`) to import
   from `src/core`; keep golden digests identical (they encode the approved
   silhouettes). Keep `_internals` export for tests. No `Date.now`/random.
   Shortfall today: tests import from `lab/`, engine is untyped JS.

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

3. **Underline geometry contract in the app.** Lab invariants that MUST be
   re-derived for the app's own underline rendering (do not copy blindly):
   - pin y = drawn underline CENTER; lab formula cancels font ink-slack
     (`lab/lab.js` `underlinePinDy` near `planOne`, ~2600) — the app must
     compute its own equivalent from however it paints phrase underlines;
   - engine `UNDERLINE_STRIP = 2.25` assumes ~1.5px underline near box
     bottom; revisit against app metrics;
   - flush any font-metric caches on `fonts.ready` (lab bug: pre-webfont
     metrics poisoned fragment bottoms → width-seeming misalignment).

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

8. **Unified authoring menu.** Port the selection bar (kinds row / divider /
   5 highlight swatches, caption "connect the words — or lay a wash").
   Decide fate of the external palette-host seam (`window.LAB_AUTHOR` /
   `LAB_PALETTE` hooks in lab/lab.js ~3460+; `lab/palette.html`+`.css` are
   UNCOMMITTED, added outside this session) — land, adapt, or drop before
   port; the seam is the natural adapter boundary for a React host.

9. **Merged painted emphasis.** Port commit `0345781`'s approach: washes +
   underlines painted from merged measured rects per anchor (continuous
   through segment boundaries/spaces/wraps; rounded only at true ends),
   spans remain interaction targets only. In-app, `.pk`-equivalent
   segmentation will come from overlapping records — same solution applies.

## P3 — known warts / cleanups (lab-side, cheap)

10. Stale overlay sizing when the viewport shrinks without a redraw
    (pre-existing; app lifecycle in item 2 makes it moot in-app, but fix the
    lab's resize path if it keeps serving as the demo).
11. Prune dormant bow planners in `lab/trace-geometry.js` + their tests
    (kept only as reference post-C0.5), or mark them explicitly historical.
12. Middle-shaft family: engine code retained but host-disabled everywhere;
    delete or leave gated — decide at port time (its silhouette failed the
    visual gate; only re-admit speaking the bracket grammar).
13. Emphasis repaint is a full batch (~59ms on Long text, 152 paths) —
    fine in lab; app should repaint incrementally per reflowed block.
14. `exportCard` (SVG export) has no app equivalent — decide scope.
15. Route Lab QA (`route.html?qa=`) digests are frozen truth
    (projection `8b2dcd67…`, sweep `3b01cd13…`); any engine change must
    re-run both and rebaseline explicitly — never silently.

## Acceptance for the app port (mirror of the lab gates)

- Engine suites green from `src/core` imports; goldens byte-identical.
- A held connection on the real reading canvas draws the bracket with runs
  exactly on the app's underline (0.0px, measured at ≥3 widths).
- Held/needs-space is an explicit affordance; nothing silently disappears.
- All four app themes; 640–1280 reflow; keyboard access on card + menu.
- All mutations through broker/RevisionStore events; no localStorage.
