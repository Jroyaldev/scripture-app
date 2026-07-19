# Loom — a marginalia threading contract (handoff to the shapes.html agent)

You are building annotation lines for rendered Scripture. Read all of this — it is
short on purpose. The previous 350-line spec is superseded; everything load-bearing
is here, plus what two implementation passes actually taught us.

A working reference engine exists: `route-engine.js` (pure geometry, zero DOM,
importable as-is) and `route-lab.js` (measurement + renderer + validation suite).
Prefer importing the engine and writing your own measurement/renderer adapter over
re-deriving the geometry.

## Philosophy (5 bullets, hold these when anything is ambiguous)

1. **One thread.** There is exactly one geometry. Kinds are stroke *treatments* of
   the same centerline, never different shapes. If you are drawing a second shape
   language, you are off-spec.
2. **The words are loud, the line is quiet.** Dots and underlines carry emphasis;
   the connector nearly disappears. When in doubt, remove ink.
3. **The margin is a loom, not a circuit board.** Threads share one datum at a
   tight strand pitch. Where a traveling shoulder crosses another thread's spine,
   the crossing is resolved like weaving: one thread pauses with a tiny gap.
4. **Density policy is the aesthetic.** One focused thread fully drawn; at most
   two more woven beside it; everything else is a whisper underline + a margin
   tick that blooms on hover. Progressive disclosure is the design, not a
   failure mode.
5. **Illegal is illegal.** `needs-space` and `kink` are returned, never painted
   over. Never solve congestion by drawing through text.

## The grammar (the only path you may draw)

```
pin → circular terminal turn → corridor shoulder → swoop port → spine
```

- **Underline**: 1.3px (focused 1.6), one per fragment, never bridging a wrap,
  at `fragmentInkBottom + 2`.
- **Pin**: solid dot, r 2.4–2.6, centered on the underline endpoint facing the
  margin, overlapping the underline ~0.75px. No air gap.
- **Terminal turn**: from the pin, a vertical-tangent quarter cubic (κ =
  0.5522847498) into the corridor immediately below the anchor's rendered line.
  Radius = the drop, min 3.2px. Bottom pins can only leave downward — never
  climb through the line to a corridor above.
- **Shoulder**: dead horizontal hairline at a verified corridor Y (optical
  center of the band; staggered ≥ 2.2px from any other claimed shoulder in the
  same corridor).
- **Swoop port**: a shallow horizontal→vertical cubic, reach ~11px, dip ~3px,
  pouring tangentially down onto the strand. All pours point down. Multipoint
  branches are tributaries; the spine runs from the first port to the last
  port and never overshoots.
- **Spine**: one vertical on the strand, round caps.
- Degenerate cases share the grammar: a **same-line pair** is a shallow hammock
  under the line (facing endpoints, two pours, flat floor inside the corridor,
  fallback to the margin route if it can't fit — never squash it). A **single
  anchor** is a tag: pin → turn → shoulder → swoop → 2.5px drip. A **same-line
  group** combs its pins into one shoulder.

## The loom (multipath, answered)

- The loom is a **page-level datum**: one inner edge for the whole text block,
  `minExpandedObstacleLeft − 10`. Compute it once per layout. Never per
  annotation — per-annotation rails drift by sub-pixel amounts and destroy
  strand alignment (this was a real bug; verse-number glyph widths differ).
- Strands at 6px pitch outward from the datum. Assignment is stable interval
  coloring: overlapping vertical intervals get distinct strands; disjoint
  intervals share; focused always strand 0; budget 3 strands; the rest are held.
- **Crossings**: the traveling shoulder passes; the spine pauses with a 3.4px
  hop gap — except the focused thread is never gapped; a shoulder crossing a
  focused spine takes the gap itself (eraser patch under the spine). Never gap
  a port merge (within 2.6px of a port, the weave yields).
- Held annotations: whisper underline (ink @ 0.30) + one 5.5px tick per anchor
  at its line center, hanging left from the held rail. Hover blooms the thread.

## Color and kind (restraint is the point)

- Default state is **monochrome**: all threads in warm ink (`#6A5638` @ 0.7),
  underlines ink @ 0.30–1.0 by state.
- **Color appears only on focus.** The focused thread takes its kind hue at
  full strength. Nothing else is chromatic. No rainbow margin.
- Kind vocabulary, complete: **solid** (default), **double** (parallel: two
  rails offset along the normal, separation `max × sin²(πt)` tapering to zero
  at run ends), **dotted** (echo: `0.1 3.8` round-cap). At most one 6px spine
  glyph: contrast = 5.5px gap at spine midpoint, mirror = small diamond, hinge
  = 5px crossbar. Series needs nothing — the tributaries are the identity.

## Hard constraints (pass/fail, never traded)

1. Obstacles = rendered lines, verse numbers, headings, fixed UI — expanded by
   `clearance + halfEnvelope`, clearance `max(2.5, fontSize × 0.12)`. No sampled
   route point (≤1px sampling) may enter an expanded obstacle except within the
   terminal exemption around its own contact.
2. Horizontal travel only inside verified corridors; a corridor needs the whole
   envelope to fit the band.
3. Long verticals only on a loom strand.
4. Every join tangent-continuous; round caps/joins; no miters, no elbows.
5. Contact error ≤ 0.25px. Spine ends exactly at first/last ports.
6. If a legal route does not exist, return `needs-space`. Do not draw through
   text. Do not invent a kink.

## Measurement (where everyone fails — read this twice)

- Use `Range.getClientRects()` **after fonts load**. Merge rects whose vertical
  centers differ ≤ 2px into rendered lines.
- **Boxes lie twice.** (a) Range rects include leading: tighten every rendered
  line *and every anchor fragment* to ink (`top + 2.2, bottom − 2.2` at 17px
  Source Serif). Underlines and pins hang from ink, never from the line box —
  an untightened fragment puts the pin inside the corridor and corrupts every
  downstream drop. (b) A grid/flex-stretched verse-number span reports a
  stretched box: measure the glyph run with a Range, not the element box.
- Never compute distance from verse numbers or reference math. Two phrases in
  one verse can be six rendered lines apart.
- The layout must reserve space: line-height ≈ 2.0–2.1 at 17px (the interline
  band must be ≥ ~5px after expansion — this is load-bearing, not optional), a
  left margin wide enough for numbers + datum + 3 strands + held rail, and an
  SVG overlay whose coordinate system exactly matches the content's.

## Your loop (do not skip — "premium" is achieved by looking, not by prose)

1. Build measurement → engine call → renderer.
2. Render the fixture page, screenshot the full page AND a 2.4× zoom of one
   margin tributary. Check against the acceptance list. Iterate until boring.
3. Drag the column width narrow and wide; re-plan must be stable, strands must
   not flicker, corridors claim deterministically (focused first).
4. Only then add kinds. Kinds are the last 5% of ink, never the first.

**Acceptance**: every line touches its words exactly; immediately enters
whitespace; travels in corridors; pours into the loom; at 3× zoom the margin
reads as one calm instrument; nothing is louder than the text; with 6+
annotations live, the page still looks like a scholar's margin, not a circuit
diagram; the focused thread is findable in under a second.

## Reference numbers (the whole tuning table)

underline 1.3/1.6px @ ink+2 · pin r 2.4–2.6 · thread 1.25/1.5px · drop ≥ 3.2 ·
swoop 11×3 (dip ≥ 1.5) · claim gap 2.2 · strand pitch 6 · loom air 10 ·
hop gap 3.4 · held tick 5.5 @ 0.55 · whisper underline @ 0.30 ·
woven ink `#6A5638` @ 0.7 · corridor band ≥ 4.2 · κ = 0.5522847498

## Implementation state — third pass (2026-07-18, route.html)

The one-paradigm cleanup landed. What changed and why, so nobody re-litigates it:

- **Density policy is now literal.** `run()` draws the focused thread plus at
  most two companions ranked *beside* it (interval overlap first, then nearest;
  page-spanning intervals rank last via the span tie-break). Acceptance requires
  a valid route — a candidate that returns `needs-space` is skipped, never
  wastes a strand. Everything else is whisper underline + held-rail tick.
  Corridor claims come ONLY from threads that actually paint.
- **One line type, full stop.** Every thread — any kind, focused or woven —
  is the same solid stroke; kind speaks only as hue on focus. Stroke
  vocabulary of the entire overlay: 1.25 woven thread+underline, 1.5 focused
  thread, 1.6 focused underline. Doubled rails (polyline offsets with sin²
  taper, then absolute taper, then a carved tube) and dotted/dashed strokes
  were each tried and rejected: at reading size a second line type reads as
  a rendering artifact, not a meaning. Spine glyphs (contrast gap, mirror
  diamond, hinge crossbar) went with them — the kind vocabulary section of
  this contract is superseded on that point.
- **Claims carry width**: `planRoute(opts.claimPad)` widens a claim on both
  sides (host passes a flat 0.25 of air). The slot ladder walks 0.6px steps
  to ±5.4. A same-line cradle passes `needsDip=false` — it has no port
  swoop, so it may settle to the bottom of the band (this is what lets a
  cradle share a corridor with a through-shoulder).
- **Measurement**: the flat ±2.2 ink tighten is gone. `inkSlack()` derives
  per-font tighten from canvas TextMetrics (fontBoundingBox − actualBoundingBox,
  cached per font). Chrome's Range rects are font-box height; the old constant
  over-tightened below baseline and under-tightened above, which is why every
  shoulder used to hug the text.
- **Held ticks** sit on a dedicated rail at `loomInner − 3·pitch − 4`, one tick
  per anchor *line* (same-line anchors share), ink @ 0.55 — never on a strand,
  never kind-colored at rest. Hover blooms (preview focus); the bloom clears
  when the pointer returns to the text column.
- **Fixed outright**: focused parallel threads rendered a NaN path
  (offsetPathD called without maxSep) — the focused thread's branches were
  simply invisible before this pass.

Verified: suite green across focus states (far-pair, five, ten, same-line,
mid-right-far), width drag 460↔760 with zero strand flicker, weave toggle,
hover bloom + clear, zero dashed/glyph paths in any state. Tuning table
stands except: one solid line type · claim pad 0.25 · ladder step 0.6.

### shapes.html follows (same day)

The one-line decision is now applied across shapes.html as well: every trace
(arc or thread, any kind, any theme) draws as the single tapered ribbon in
its kind hue, with the same nib draw-on animation. Removed: echo dotted
strokes, parallel rails (arcs and threads), contrast halves, the mirror
twin-swell + diamond joint, series ticks, per-kind score/overview signature
CSS, the export card's dotted echo spine, and the dashed provisional
authoring wire (now the same line at 0.45 opacity — uncommitted reads as
reticence, not a dash). `trace-geometry.js` still exports the old helpers
for its tests; the lab no longer calls them.

### Steps 0+1 of PLAN-semantic-routing landed (same day)

The same-line grammar is amended: **same-line pair = hammock: pins on the
facing underline ends when the gap can carry two terminal turns and a real
floor (gap ≥ 12); pins on the outer ends — the held pair, "embrace" — when
the gap is too tight (< 12) or both phrases are single short closed words
(each ≤ 2.5em, gap ≤ 2em, span ≤ 7em).** Embrace requires both anchors
closed (one fragment) — a wrap edge is not a phrase end. The floor-length
test `(bx−ax) − r1 − r2 ≥ 5` lives INSIDE the slot ladder (new `fits(y)`
callback on corridorYFor), which kills the latent floor-inversion bug and
lets a too-deep slot retry shallower. Plans carry `cradleVariant`.

corridorYFor now precomputes its legal window (minY = contact + DROP_MIN,
maxY = band bottom − dip room) and centers the ladder on the window instead
of the band — shoulders sit at the optical center of the room they actually
have, and razor-thin 0.01px-clearance plans became honest 0.3px ones.
Fixtures added: adjacent-pair (grass/herbs, embrace by necessity),
short-pair (days/years, facing — its gap sits just past the 2em preference
boundary). Suite gains a cradle-floor ≥ 5 check.

### Steps 2+3 landed (same day)

Collision truth is now **word runs** (per-word ink rects, per-font slack,
cached on layout dimensions, y-bucketed index) — a strict subset of line
rects, so routes only become more legal; corridors and the loom datum
still derive from merged lines. And the terminal exemption is now
**ownership-scoped**: a terminal turn may pass only through its OWN
fragment's expanded rect plus the departure wedge at its own pin
(expand+1 disc); floors, shoulders, swoops, spines, and drips have no
privileges. The old any-contact expand+3 radial blanket is gone. All 14
fixtures route focused, suite green at every width 460–760.

### Step 4 landed (same day)

Companion ranking is engine-owned: `rankCompanions(intervals, focusId)`
exported beside assignStrands (overlap-first, then nearest; smaller spans
beat page-spanning ones). The host ranks against the COMMITTED focus, not
the hover preview — a tick bloom adds the previewed thread and keeps the
woven pair fixed instead of reshuffling the margin. The preview-clear
listener no longer rides requestAnimationFrame (frames are on-demand in
headless surfaces; the previewId guard already makes it one-shot).

### Steps 5+6 landed (same day)

Weave crossings are EXACT: computeHops solves each traveler segment
against the crossed spine (horizontal travels directly; x-monotone
quarter cubics by 24-step bisection) — the hop gap lands on the curve,
not a sampled-cluster average. splitSpine merges overlapping gaps and
drops slivers; the pause under a focused spine is an angle-invariant SVG
mask bite (r 2.6), theme-proof by construction. Weave suite tolerance
tightened to 1.9.

And the loom explains itself: planRoute records structured facts —
diagnostics.declined ({move, why}), fail(reason, detail) — and the host's
explainPlan() turns them into one honest sentence under the focused
fixture row plus a route label in the suite summary ("direct hammock ·
embrace", "left loom · tributaries", …). A cradle checkbox in the topbar
forces margin routing (opts.disableCradle) so the fallback is always one
click away from inspection.

### Steps 7+8+9 landed (same day)

Held ticks got real hit targets (15.5×12 invisible rects, 7px-clipped
when stacked) and a roving keyboard: one tab stop, arrows walk the rail,
Enter holds, Escape lets go; a tick-previewed annotation keeps a phantom
hit rect through its bloom so layout and focus never jump. The engine
gained the spine-separation tripwire (fail "spine-separation" when a
committed spine claim overlaps within min(4.8, pitch−1.2); inert at
pitch 6, armed for shafts/right margin). And single-line ideas now stay
LOCAL: when every anchor shares one rendered line and the cradle
declined, a short rail plants 22–34px left of the phrase group — same
pin → turn → shoulder → swoop grammar, adaptive 1–2.5px drip pooled in
the corridor, dual corridor claims (shoulder + drip zone), no strand
consumed (modes local-tag / local-comb). A one-word tag is now a ~25px
scribal flick instead of a page-crossing dead shoulder. Toggles: cradle
+ local checkboxes force margin routing for inspection.

### Steps 10+11 landed (same day)

The margin route is now generated behind a **dormant scorer seam**:
genMargin(side, strand) candidates are scored (raw ink length + 0.035/px
wrong-side penalty + 12 side hysteresis) and the best returned with
diagnostics.score + alternativesConsidered. With sides ['left'] the
scorer is the identity — the seam exists so a future right margin
arrives as a continuous preference, not a rule. And **strand choice is
engine-owned and claims-driven**: committed spines emit strandClaimOut
{side, strand, top, bottom}; a candidate takes the lowest strand whose
claims (±6px slack) don't overlap its interval, escalating only on
failure; focused always [0]. Cradles and local rails consume no strand,
and a starved margin no longer starves them (the strandX bound checks
moved out of the pre-cradle path). Failure reporting prefers
needs-space over kink over obstacle-collision. assignStrands remains
exported but demoted; the host's inline strand loops are gone.

### Level exits landed (same day) — a grammar amendment

**When everything between a pin and its rail is genuinely clear, the
connector continues straight from the underline** — colinear, through
the pin bead, one quarter corner into the spine: `———•‾‾‾‾` instead of
the dip-and-hook. The terminal turn and corridor drop are now the
grammar for anchors with ink in the way, not the default. Word-run
obstacles make the clearance test honest (verse numbers are superscript
ink and usually clear it; a mid-line anchor's left neighbors never do).
Within a same-line group, only the nearest-to-rail member can be clear
— it exits level and the rest comb below in the corridor, so stacking
falls out of the clearance check rather than a rule. Applies to margin
routes (per group) and single-member local rails; cradles unchanged.
This amends hard constraint #2: horizontal travel is legal at underline
level when the ENTIRE run verifies clear — it crosses only margin air.

Rode along: the port-merge yield now applies only to hop gaps (gapping
a traveler near a focused port never harms the pour, so patches apply
everywhere), and the weave suite check credits yielded woven-over-woven
crossings at ports. diagnostics.exits records level/drop per group.

### Step 12 phase A landed — shapes.html Traces run on the Loom engine

lab.js is a module importing planRoute. The Traces view plans every inked
trace through the engine (focused first; corridor/spine/strand claims
flow exactly as in route-lab) and renders plans in shapes' own voice —
the tapered ribbon per continuous run, split spines around hop gaps,
mask-bite weave pauses, contact dots. Reading view stays on
trace-geometry's local bows; the geometry tests are untouched.

What the port taught us (all landed engine/host-side):
- Degenerate zero-size element rects must be filtered from additional
  obstacles — one hidden element at (−16,−215) dragged the loom datum
  off-page and killed every margin route.
- Rendered lines now derive FROM the word runs (mergeInkLines of the
  run rects) — element Range rects lie about leading on synthetic block
  markup (the qa sheet), words never do.
- The bottom overscan corridor is real page room: widened 6 → 16 (top
  6 → 10) so a cradle floor and a staggered shoulder can coexist below
  the last line.
- Traces mode reserves the contract's leading (2.08 / compact 2.1 /
  geometry 2.05) via body[data-route="traces"] — Reading keeps its
  tighter set. Two staggered shoulders per corridor need it.

Phase B remains: held ticks + explanations in the score panel, lane
hysteresis, rankCompanions replacing recency disclosure, cold-wake perf
on the 51-verse sheet, exportCard reflecting real route classes.

### Step 13 landed — the middle shaft (gated constraint amendment)

For the FOCUSED thread only (opts.allowMiddle, host-gated), when anchors
sit within three rendered lines, a short interior vertical may stand in
genuine whitespace near the semantic center. Crossing a line's ink
extent is ILLEGAL, not scored: the shaft must clear every crossed line
entirely (hard zero-crossing filter), so it fires in ragged-right voids
and short-line shortfalls, never through justified prose. Candidates:
semantic center ± 6px grid to ±36, first legal wins. Pins face the
shaft per group (mirrored terminals — the same machinery a right margin
needs); no strand consumed; spine claims emitted so the separation
tripwire guards it. Amends hard constraint #3 for this one mode.
Fixture: day-night ("he meditates" → "night") draws the becoming
pattern — two shoulders from opposite sides into a shaft standing in
the void of the short line — 311px of ink for what was a ~900px margin
round trip. Deterministic 460–760. Toggle: middle checkbox.

### Step 12 phase B landed — shapes disclosure, ticks, explanations, perf

Disclosure is ranked, not recency: engine rankCompanions picks the three
companions beside the focus, with 35px lane hysteresis so lanes don't
reshuffle on focus hops. Everything active-but-not-drawn (over-budget or
needs-space) gets a held tick on the rail — hover previews (phantom hit
rects persist through the bloom), click holds. The expanded score row
explains its route in one honest sentence from the actual plan ("direct
hammock — both phrases share one verified corridor…", "held — no
corridor slot or strand is free…"). And warmBlocks() pre-warms the
word-run caches on idle after every rebuild: cold wake of the 51-verse
Long sheet dropped ~2000ms → ~200ms.
