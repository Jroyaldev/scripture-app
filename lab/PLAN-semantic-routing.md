<!-- Adoption plan for the ideas in ~/Downloads/loom-semantic-routing-2026.html
     (the "Intelligent" routing study). Produced 2026-07-18 from a 22-agent
     analysis pass (3 readers, 16 per-idea judges + hammock deep-dive,
     synthesis, adversarial verification). Companion to PROMPT-loom.md. -->

# Adopting "Intelligent" Semantic Routing — Final Plan

**Sources:** reference `/Users/jonnyroyal/Downloads/loom-semantic-routing-2026.html`; targets `/Users/jonnyroyal/dev/scripture-app-shapes/lab/route-engine.js`, `lab/route-lab.js`, then `shapes.html`/`lab.js`.

## Executive summary

The reference's real contribution is not new line shapes — it is **decision structure**: candidates, a scalar score, honest per-candidate reasons, word-level obstacle truth, and ID-scoped exemptions. We adopt that skeleton and reject every idea that puts competing ink inside the reading column (interior rails between words, soft-penalty crossings, dotted taxonomies). Everything we take stays inside the one-line paradigm: same solid stroke, hue only on focus, density trio. Hard constraints hold throughout, with one explicit, gated amendment in the final step (a focused-only interior shaft amends “long verticals only on a loom strand”). The scorer lands as **dormant scaffolding** (`sides:['left']`, pixel-identical output) so future side choice is continuous and calm instead of rule-bound. Net effect for the reader: fewer silently-missing companions, shorter ink for short relations, and a margin that gets *thinner* as the system gets smarter.

**Prerequisites before step 1:** fix the two stale assertions in `tests/pattern-shapes-geometry.test.ts:254-255` (mirror-joint/series-tick — suite is red today), and grow `drawOverlay`'s cache key in `lab.js` (~755) to include any future scoring inputs before the shapes port ships.

## Step 0 — The hammock answer (facing vs embrace) — ✅ LANDED

**Verdict: adapt.** Three-regime policy in `planRoute`'s same-line branch (route-engine.js:192-216), constants at 17px: `FLOOR_MIN 5`, `GAP_FACING_MIN 12`, `GAP_EMBRACE_MAX 16`, `W_SHORT 2.5em (42.5)`, `GAP_PREFER 2em (34)`, `SPAN_MAX 7em (119)`. With `gap = B.left − A.right`, `span = B.right − A.left`, `embraceEligible = both anchors closed (one fragment) && span <= 119`:

1. Short closed pair (`wA,wB <= 42.5 && gap <= 34 && embraceEligible`) → try **[EMBRACE, FACING]** — enclosure is the truer drawing for Day/Night pairs, and it moves pins off the comma into calm outer whitespace.
2. Else `gap >= 12` → **[FACING]**, appending EMBRACE iff `embraceEligible && gap <= 16` (rescues deep-slot floor failures only — the reference's `gap <= 30` is dead range; facing always wins above ~16).
3. Else (`gap < 12`, two turns physically can't fit) → **[EMBRACE]** if eligible, else fall through to margin. Never squash.

```
FACING — pins on the facing ends,       EMBRACE — pins on the outer ends,
floor under the GAP:                    floor under the PAIR:
  ...righteous ,  but the way...           Day , Night
  ‾‾‾‾‾‾‾‾‾‾‾•    •‾‾‾‾‾‾‾‾                •‾‾   ‾‾‾‾•
              \___/                         \________/
  reads as LINK (A relates to B)           reads as ENCLOSURE (held as one)
```

**Critical fix riding along:** move the acceptance test *into* the slot ladder (`corridorYFor` callback): accept slot y iff `r1 = y−ay >= 3.2 && r2 = y−by >= 3.2 && (bx−ax)−r1−r2 >= 5`. This replaces the post-hoc `bx−ax >= 16` gate, kills the latent **floor-inversion bug** (loose leading → r≈10.5 → negative floor → path doubles back, undetected by point sampling), and lets a too-deep slot retry shallower instead of aborting to the margin. Pins: facing `A.right−0.5 / B.left+0.5`; embrace `A.left+0.5 / B.right−0.5`. Same quarterVH → L → quarterHV grammar; emit `cradleVariant: 'facing'|'embrace'`. Embrace requires closed anchors — a wrapped phrase's break edge is not a phrase end.

**Accept:** lab fixture — adjacent pair gap<12 plans `same-line/embrace`, no strand, no spine; gap 20 pair plans facing; loose-leading fixture (2.5em) no longer inverts; wide clause (span>119) still combs to margin.

## The sequence (go one by one)

### 1. The ladder becomes the validator — *adapt* (ideas: corridor bounds + generic spine planner) — ✅ LANDED (corridorYFor window; planSpine extraction deferred to step 9/10)
- **Build:** in `corridorYFor` (route-engine.js:139) precompute `minY/maxY` (contactY+DROP_MIN, band.bottom−claimPad−dip), center ladder on the legal window `clamp((minY+idealMax)/2, minY, maxY)`, range-skip instead of per-rung drop/swoop rejections; keep dip compression (don't subtract full swoopDip as the reference does). Extract margin-route body (218-294) into `planSpine(groups, spec, ctx)`; add `clearAtY(y)` callback evaluated last per rung: r >= 3.2 per member (kink becomes a 0.6px retry, not a plan kill), shared `cubicClear` factored out of `finalize` (one exemption implementation), adaptive reach kept, ordering guard `minEndX >= strandX + reach + 1.5`. Do NOT re-pad band edges with halfEnvelope (double-counts) and do NOT fold the drip into the spine.
- **Prettier:** shoulders sit at the optical center of the room they actually have (~1.5px higher, consistently); threads that today silently demote to ticks land 0.6-1.2px off-center and paint — the trio is actually a trio on dense passages. Zero new strokes.
- **Accept:** suite green; Dense Psalm + Long text: needs-space count drops, `kink` nearly vanishes from diagnostics; tight-band test (4.2-5.5px, minY forced by contact) still plans.

### 2. Word-run obstacles — *adapt*
- **Build:** `measure()` in route-lab.js grows a `textRunRects` pass (TreeWalker, `/\S+/g`, Range rects filtered width>0.4/height>1, **per-parent inkSlack** — fixes the single-slack cache at :131-135), stamped `{owners, li}`, emitted as `block.wordRuns`. Corridors/BAND_MIN still derive from merged lines; `hardObstacles = wordRuns + vnums + additional`, li-bucketed Map so clearRun/finalize check only adjacent-line buckets. No interior-shaft candidate rides in; the module-header constraint list stays verbatim.
- **Prettier:** subtractive wins only — companions that failed because one descender poked an otherwise-clear shoulder span now draw; shoulders stop dodging ink that isn't there. Text column gains zero ink.
- **Accept:** loom datum unchanged (assert min word-left == min line-left); Dense Psalm picks up ≥1 previously-skipped companion; relayout stays low-single-digit ms.

### 3. Ownership-scoped terminal exemption — *adapt*
- **Build:** replace finalize's radial `expand+3` blanket (route-engine.js:305) with per-segment exempt sets keyed by `anchorKey`: terminals exempt only their own contact's fragment, shoulder/port the group union, spine/drip nothing. `block.anchorFragments` from measure; kill the +3 constant. This is the load-bearing prerequisite for any right/opposite pin.
- **Prettier:** calmness insurance — a pin's curl can provably hug only its own word's ink, never a neighbor's descender; near-miss smudges become honest needs-space (our vocabulary for held).
- **Accept:** new validate() check — no sampled point inside an expanded obstacle without a matching owned fragment; Dense Psalm/Long text before/after, small held-count uptick expected and correct.

### 4. Companion ranking hoisted + preview bug — *adapt*
- **Build:** export `rankCompanions(intervals, focusId, {overlapPad: 0.5, pageSpan})` from route-engine.js beside assignStrands (sort: intervalDistance asc, span asc, top, id; `pageSpanning` demoted to a diagnostic — the 0.62 sort key is provably subsumed by span-asc). run() imports it; **rank against committed `focusedId`, not `effectiveFocus`** so hover-bloom previews additively instead of reshuffling the woven pair.
- **Prettier:** margin activity follows the reader's eye; hover stops making the margin flicker.
- **Accept:** hover a held tick on Long text — the two companions do not swap; node:test on overlap-first/span-tie ordering (engine is import-clean).

### 5. Weave exactness and polish — *adapt* (split-spine + mask eraser + solveCubicYAtX)
- **Build:** `splitSpine(spine, gaps)` with merged intervals (±1.7, merge tol 0.2, drop slivers <0.25px) replacing the sliver-prone loop at route-lab.js:220-231; eraser becomes an SVG `<mask>` circle **r 2.6** (angle-invariant bite; reference's 2.32 under-covers the 2.8 validation band) replacing the 3.8×5.2 paper rect at :332; name the layers (held/woven/mask/focus). Adopt `solveCubicYAtX` (24 bisection iters, x-monotone guard, cluster-average fallback) as computeHops' narrow phase; finalize returns `segments`. Reject `cubicClear`/`cubicLengthEstimate` — segPoints' control-polygon bound is already conservative at ≤1px. Tighten weave-clear tolerance 2.2 → 1.9.
- **Prettier:** hop gaps land exactly where the traveler crosses (today ~0.3-0.5px off on swoops — reads as a nicked spine at 3x); erasers are theme-proof (no paper-colored coins on Glass/Candlelight).
- **Accept:** suite at 1.9 tolerance green on both dense fixtures; zoom a strand-1-over-strand-0 crossing — gap centered on the curve.

### 6. Explanation plumbing — *adapt* (mode control deferred)
- **Build:** engine records structured facts only — `diagnostics.declined` (as a list, scorer-ready), `fail(reason, detail)`, corridor displacement counts. Host-side pure `explainPlan(plan, ann)` renders label + one sentence in the fdiag row; status line `${painted} painted · ${held} held · ${label}`. Add a `force margin` checkbox (`opts.disableCradle`); do NOT add the left/right select (dead UI).
- **Prettier:** zero ink — protects the honest-failure contract; when a thread becomes a tick the answer is a sentence, not a loosened clearance.
- **Accept:** declined emitted only when a branch was genuinely attempted (3-anchor annotation never claims "cradle didn't fit"); shadow-plan reasons labeled "if focused now".

### 7. Held-tick hit targets — *adapt* (side choice deferred)
- **Build:** invisible 15.5×12 hit rects per tick in a `gHits` group, widths clipped to the 7px collision step; **roving tabindex** (one tab stop, arrows move, Enter focuses) — never per-tick tabindex=0 (dozens of stops on Long text — one per held tick, not per annotation — and Tab cycles study lenses by design). Keep tick 5.5 @ 0.55.
- **Prettier:** pixel-identical at rest; hover stops being a 1.2px pixel hunt.
- **Accept:** stacked-tick fixture — each hover previews the correct annotation; keyboard path reaches every held tick without polluting Tab order.

### 8. Spine-separation tripwire — *adapt*
- **Build:** in finalize(), reject `spine-separation` when any `opts.spineClaims` entry overlaps the spine's y-interval (pad **2.6**, not the reference's 1 — 1px permits a visually broken single line) within `SPINE_SEP = min(4.8, strandPitch − 1.2)`. New `spineClaimOut` field (never folded into claimsOut); suite check added. Provably inert today at pitch 6 — document it as the tripwire for shafts/right-margin, or a cleanup pass will delete it.
- **Prettier:** a doubled rail was rejected as vocabulary; it cannot be re-admitted as a routing accident.
- **Accept:** suite assertion green; distinct failure reason surfaces in diagnostics, backfill from ranked list works.

### 9. Local rails for single-line ideas — *adapt*
- **Build:** new branch between cradle and margin, gated `groups.length === 1` and cradle declined: candidates `uniqueXs([xMin−22.2, −28.2, −34.2])` (off = SWOOP_REACH 11 + DROP_MIN 3.2 + 8; dedupe 0.55), floor `x >= loomInner + 6`; drop textCenter and right-mirror candidates. **Adaptive drip** `clamp(band.bottom − portY − 0.25, 1.0, 2.5)` + `tailMin` param on corridorYFor (our ~8-10px bands otherwise kill most local tags), **dual claimsOut** (shoulder y + drip midpoint) and `plan.spine = {x: localX, ...}` so hops see the drip. Modes `local-tag`/`local-comb`; committed local plans consume no strand; trio cap on drawnIds untouched. First legal candidate wins.
- **Prettier:** the worst case today — a one-word tag dragging a 200-300px dead shoulder to the loom for a 2.5px drip — becomes a ~25px scribal flick beside the word; the loom becomes legible as "these ideas travel."
- **Accept:** validate() additions: drip span ≤ 6, dual claims present, local x >= loomInner+6, no strand consumed; dense fixtures show no uncovered crossings through the drip window.

### 10. Dormant scorer — *adapt*
- **Build:** split planRoute into `genCradle()`/`genMargin(side, strandIndex)` sharing the closure; cradle stays a **pre-emptive hard winner** (never scored — the reference's `length*0.25 − 40` is just "direct always beats margin" with a wasted sampling pass). Scoring seam between generators and return: `score = rawLength (UNROUNDED — never diagnostics.totalLength) + K[side] + wrongSide(0.035/px of group-center offset) + hysteresis(+12 if previousSide differs; never raise past ~20)`. Round to 0.1, tie-break modePriority `{same-line:0, tag:1, corridor:2, multipoint:2}` then innermost strandX. `opts.sides` defaults `['left']` — **pixel-identical day one**; emit `diagnostics.score` + alternativesConsidered. Budget: ≤3 finalize() calls per thread. Failure semantics: prefer needs-space over kink over obstacle-collision as the reported reason.
- **Prettier:** when right-margin exists, threads choose the nearer, emptier margin as a quiet preference; +12 hysteresis keeps held threads from flapping sides on refocus.
- **Accept:** pixel-identical on Dense Psalm and Long text (screenshot diff) with sides:['left']; score panel shows alternatives.

### 11. Claims-driven strand availability — *adapt*
- **Build:** strand claims `{type:'strand', side, strand, interval}` in claimsOut (spined plans only — cradles/drips never claim); `availableStrands(side)` with **±6px interval slack** (the reference's 0.5 pad lets spines kiss); focused ⇒ [0]. Try lowest available strand, escalate only on failure; `[]` ⇒ needs-space. Delete run()'s inline while-loops (:523-534); demote engine `assignStrands`. Symmetric right datum (`rightLoomInner = maxRight + 10`) ships as spec, disabled.
- **Prettier:** disjoint threads *share* strand 0 — the margin thins as reading proceeds instead of stacking three deep by recency.
- **Accept:** two vertically disjoint companions land on the same strand; Long text refocus does not stutter (≤2 margin candidates per annotation).

### 12. Shapes adoption — the port
- **Build:** `shapes.html` adopts route-engine per the settled path: `measure(sid)` grows renderedLines/vnum rects/**wordRuns from day one** (dense shapes fixtures are where line-level clearRun manufactures needs-space); `planArc` becomes a thin wrapper; lane math replaced by claims-driven strands; drawArc consumes `RoutePlan.sampledPoints` for ribbonDraw (splitSpine segments each get their own 16% end ramps; mask eraser mandatory — four themes). Held-tick + roving-tabindex UI and explainPlan labels land with the port (first UI shapes ever had for honest failure). `rankCompanions` replaces recency-lanes with two amendments: pinned is a hard tier, and lane hysteresis ~35px (one line-height) so lanes don't reshuffle per focus hop. **sides stays ['left'] hard** — the right rail UI occupies that whitespace and the SVG clips at the sheet. Fix draw-order vs claim-order (focus claims first, paints last) and grow the drawOverlay cache key. Re-baseline pattern-shapes-geometry tests against RoutePlan output; re-baseline qa angle-proof `data-route` attributes and docs/ui-audit screenshots deliberately.
- **Accept:** Dense Psalm (14 traces) and Long text (22 traces; the 18 added ones carry 92 anchors) render with no silently missing connectors; exportCard still schematic (recorded decision); atmosphere switch shows no eraser coins.

### 13. Middle shaft + approach-side grammar — *adapt* (the one constraint amendment; last on purpose)
- **Build:** planRoute branch between cradle and margin, gated `groups >= 2 && lineIndexSpan <= 3` (**middleLineLimit 3**, tighter than reference's 4) `&& opts.allowMiddle` — host passes it **only for the focused thread** (one interior vertical per page, ever). Candidates: semanticCenter + **6px grid (middleGrid)**, dedupe 0.55, **hard zero-crossing pre-filter** (shaft must clear every intervening expanded line entirely — replaces the reference's 15-point soft penalty outright), cap 24 pre-filter / 8 planned, first legal wins. Requires the mirrored terminal work: `approachSideFor(group, spineX)` (fail `spine-over-group` when neither side clears by DROP_MIN+2), side-aware `pinOf`, mirrored quarter cubics with the kink guard replicated; `pinStrategy:'opposite'` only as fail-only host retry (drop floor 4.5, widened clearRun span), never the +9 scorer. Amend validate()'s long-vertical rule for `mode === 'middle-shaft'` in the same commit. Shapes inherits automatically; spine-sep tripwire (step 8) is already armed.
- **Prettier:** a 2-3-line relation stops costing 2x the column width of margin travel — two 10-20px shoulders and one quiet vertical standing in the ragged-right void where the eye already sees nothing. Fires never on justified prose, correctly.
- **Accept:** justified fixture proves graceful fall-through; Dense Psalm screenshot re-check (trio balance shifts when focus frees strand 0); "bottom pins only leave downward" fixture on the mirrored path.

## Deliberately rejected

- **Interior threading between words at a soft penalty** (`interiorLineCrossings*15`) — crossings are illegal, not expensive; the penalty is the reference confessing it looks wrong.
- **'Local' rails at text-center / 'middle' shafts through word gaps** — unmoored mid-column ink; gap columns jump on every reflow.
- **72-candidate middleRailXs grid + 2x pinStrategy enumeration** — perf and determinism poison (~150 candidates vs our ≤3-8).
- **Scoring the cradle as a candidate** — its formula is "direct always beats margin"; that's our fall-through with a wasted sampling pass.
- **tagDrip folded into the spine** — breaks the ports-exact suite invariant.
- **cubicClear/cubicLengthEstimate polyline pre-pass** — segPoints is already conservatively ≤1px, cheaper.
- **Copy-on-write claims Map on candidates** — claimsOut-on-plan already isolates losers.
- **halfEnvelope band re-padding** — double-counts the envelope, ~2px band shrink, manufactured needs-space.
- **Paper-colored eraser rects** — background coupling; four themes say mask.
- **Per-tick tabindex=0** — 19 tab stops colliding with intentional Tab-cycles-lenses.
- **Intelligent/left/right mode select** — dead UI until right-margin routing exists.
- **pageSpanning sort key** — provably subsumed by span-asc.
- **Reference numbers overridden:** embrace gap ≤30 → 16 (dead range above); spine-sep pad 1 → 2.6; strand-share pad 0.5 → ±6; hop bite r 2.32 → 2.6; solver 28 iters → 24; fixed swoop reach → keep adaptive.

## Later

- **Right-margin routing + shadow-plan-slaved tick sides** (12px hysteresis) — gated on renegotiating the shapes rail/sheet layout; scorer and strand specs are already shaped for it.
- **Claim x-extents** — fixes corridor-claim coarseness that wide embrace/local floors make marginally worse.
- **Word-run cradle depth** (ignore-own-line) — hammocks tracking the local gap instead of the line's deepest descender; recorded so it isn't reinvented as a new line type.
- **A-wraps-from-previous-line cradle** (exit-end facing pins) — pure facing grammar, currently misses to margin.
- **exportCard miniature reflecting real route classes** — currently schematic by decision.