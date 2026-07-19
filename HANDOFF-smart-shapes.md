# Smart Shapes / Loom — pause handoff after C0.4

> **Paused:** 2026-07-19
>
> **Active worktree:** `/Users/jonnyroyal/dev/scripture-app`
>
> **Implementation baseline:** `codex/smart-shapes` @ `6bd0959` (`Add section-aware Loom handoffs`)
>
> **Honest status:** the routing and disclosure system is a strong, committed
> lab proof. Its current endpoint and side-switch silhouettes are not clean
> enough to freeze into the application. The strict TypeScript/app port has not
> begun.

## Start here

Do **not** port the present geometry unchanged.

Preserve the hard-won routing contracts—measured ink clearance, deterministic
claims, automatic left/right selection, explicit semantic sections, plural
spines, held disclosure, and fail-closed ownership—but run one small visual
grammar gate first. The remaining problem is not whether the engine can find a
legal route. It is whether the route touches the words and changes direction
with the quiet inevitability of the rest of the reading surface.

The next model has permission to simplify. Prefer one calm, obvious line over a
clever curve. The user explicitly favors quality, aesthetics, and function over
preserving an implementation detail from the exploration.

## Product goal

Build a production-ready **Smart Shapes / Loom** annotation system for
Scripture:

- exact phrase underlines and contacts;
- intelligent connectors that never cross prose;
- automatic left/right margin choice;
- legal side changes only through declared semantic-section whitespace;
- clear focus, quiet companions, and explicit held items at density;
- deterministic behavior through resize, theme, focus, and reflow;
- translation-safe durable anchors and explicit user-owned mutations when the
  system reaches the app.

The line should help a reader see a semantic relation without becoming an
illustration of the routing algorithm.

## The user's explicit visual amendment

Some older Loom prose says that bottom pins only leave downward, all pours point
down, and a section change is exactly one stretched cubic S. Those rules were
useful during exploration, but the attached evidence shows the result is wrong
at the reading scale. The user's present direction supersedes those silhouette
details:

1. **Top contact:** leave the underline straight and horizontal through the dot.
   Turn only after there is clear air.
2. **Bottom contact:** approach from below, round upward, and finish straight and
   horizontal into the underline. Never descend into a bottom dot from above.
3. **Same-line relation:** use the simple cradle logic: the left end descends,
   the floor stays under the words, and the right end rises back to the
   underline. Both dots get a clean horizontal contact lead.
4. **Left and right:** implement one geometry and mirror it. Do not maintain two
   independently tuned path dialects.
5. **Section side switch:** “S” names the topology, not a glyph. Cross the
   declared whitespace nearly flat, with short rounded turns in the margins.
   Do not draw a decorative S, long diagonal, or central staircase.
6. **One line vocabulary:** hue, opacity, focus, and underlines carry meaning.
   Kinds must not earn ornamental bends or different connector silhouettes.

No weird angles. No hooks. No doglegs. No abrupt 90-degree step in the middle
of the page. No long page-wide cubic merely because the route is called an S.

## Four-image visual brief

The original screenshots were attached to the Codex pause request. Their temp
filenames are recorded below in case they remain available, but the diagnoses
here are the durable handoff.

| Evidence | Read | Required change |
|---|---|---|
| `codex-clipboard-eda9d01d-16e0-4c6d-bee0-aa3480a4b8d0.png` | Beige top-to-bottom left-margin relation. Structurally close, but the top immediately droops and the lower attachment still feels generated rather than inevitable. | Keep the upper contact level with the underline; at the lower phrase, travel below the line and round upward before a straight contact lead. |
| `codex-clipboard-51d01c1d-5eb1-4750-8e7b-29b5590e3746.png` | Orange same-line cradle. This is the closest conceptual reference: down on the left, flat beneath the words, up on the right. The right contact can still read as an angled wedge. | Make the two terminal constructions true reflections, preserve a real flat floor, and give both dots a visibly horizontal lead. |
| `codex-clipboard-99fe0274-3939-452b-a894-734cf180f2d1.png` | Purple lower-left to upper-right route with a central vertical step. It reads as a rounded staircase, not a quiet relation. | Remove the central shaft/jog. If the relation can use declared whitespace, cross it near-horizontal with short edge turns; otherwise use a legal margin route or `needs-space`. |
| `codex-clipboard-607f8d75-5e0a-479d-970a-6a3449986a70.png` | Purple vertical arrives from above and turns into the lower underline. The bottom endpoint visually turns down rather than rounding up from below. | Put the vertical travel below the lower contact and return upward into a horizontal lead. Bottom attachment role must not depend on SVG traversal direction. |

## A deliberately small geometry vocabulary

This is a starting direction, not a demand to preserve a particular formula.
The next model should improve it if browser evidence supports something simpler.

```text
top       underline •────────╮
                             │

bottom                         │
                               ╰────────╮──────• underline
                                        lift

cradle    phrase •──╲________________╱──• phrase

handoff   left spine │
                     ╰──────────────────╮
                                        │ right spine
```

Recommended primitives:

- a short, exact horizontal lead at every phrase dot (start with 6px);
- one shared rounded-corner token (start with 6px, shrink only for measured
  clearance);
- exact horizontal and vertical straight segments;
- short named curves only where direction changes;
- for a lower contact, a shallow horizontal-tangent lift followed by a straight
  lead into the dot;
- for a section switch, two compact edge turns around a literal horizontal—or
  nearly horizontal—clear-gap run, rather than one page-wide cubic.

The crucial implementation rule is to define terminals by **visual role**
(`top departure`, `bottom return`, `cradle left`, `cradle right`), not by the
direction in which an SVG path happens to be assembled. Reverse segments and
control points when traversal reverses; do not generate a different silhouette.

If a gap cannot support this clean shape while preserving hard clearance, keep
one whole-route side or return `needs-space`. A preferred silhouette never buys
a prose crossing.

## What is sealed

### The 14-step adoption arc

The path from one line type through the decision-structure adoption is complete
on the Shapes lab branch history:

- `60d6efb` — obstacle-aware Route Lab from first principles;
- `a169815` — one-line paradigm across Route Lab and Shapes;
- `72ac5e2` through `8a5775b` — verified corridors, word-run obstacles,
  terminal ownership, ranking, weaving, explanations, held ticks, separation,
  local rails, scoring, and claims-driven strands;
- `d97a22b` — level exits: a connector continues straight from an underline
  when the entire run is genuinely clear;
- `c57486d` — Shapes phase A on the Loom engine;
- `eda43bf` — focused-only, hard-zero-crossing middle shafts;
- `439c603` — Shapes phase B: held ticks, explanations, ranked disclosure with
  hysteresis, and cold-wake prewarming.

This work established the right product behavior at density: focused-first
planning, at most four drawn traces in Shapes, explicit ticks for everything
held or honest `needs-space`, stable hover bloom, and no silent disappearance.

### The three post-plan routing gates

- `fb1e7e4` — **C0.2 claim X-extents.** A corridor claim is not “this entire
  row is occupied.” It records the finite horizontal span actually used:
  `{ corridor, y, xMin, xMax, pad }`. Two shoulders at similar Y can share a
  corridor when their padded X ranges do not overlap. Malformed legacy claims
  remain conservatively full-width.
- `7ecea7b` — **C0.3 bidirectional routing.** The engine mirrors the whole
  margin grammar, allocates strands independently per side, compares legal
  candidates by ink/semantic fit plus 12-unit hysteresis, and keeps held ticks
  side-correct. There is no manual left/right mode.
- `6bd0959` — **C0.4 semantic-section topology.** Explicit stable sections and
  measured hard-clear gaps enable plural `sideRuns`, `spines`, `handoffs`, and
  claims. A bounded deterministic solver chooses the complete topology; the
  hosts validate ownership and the provisional weave before committing memory
  or occupancy.

### Verification at the pause

- focused Route Engine + Shapes: **43/43**;
- full suite: **488 total, 478 passed, 10 expected native-ABI skips, 0 failed**;
- rendered Route Lab sweep: **5,719 states / 11,438 renders**;
- frozen C0.3 fallback oracle: **4,515 states**, digest
  `323bc250ff08ab0304750d26faf878599a2d0adbb65a10e44b4158e7e482c5c8`;
- C0.4 sweep digest:
  `2b32817dff61b669e2c4915d433cea573d3f95bce2a54712fa0c7234c62622a0`;
- real Revelation right-to-left section trace stable at 1280 and 640 in Paper,
  Ink, Glass, and Candlelight, with clean logs, no overflow, and correct held
  ticks.

These gates prove legality, determinism, ownership, and bounded behavior. They
do **not** amount to user approval of the four silhouettes above. Expect an
intentional geometry digest change when the visual amendment lands; rebaseline
only after the new shape is visibly approved.

## What was tried and what it taught us

- Kind-specific silhouettes, double/dotted rails, spine glyphs, and ornamental
  “shape grammar” were explored and rejected. At reading size they looked like
  rendering artifacts or diagrams. One centerline is better.
- Bows and then orthogonal Traces taught useful density and lane lessons, but
  “cable management” can become visible as a system. The line must recede.
- Same-line facing/embrace cradles, local rails, margin routes, and one gated
  middle shaft were added as legal fall-through families rather than scored
  visual variants.
- Level exits were added because a mandatory dip-and-hook at every phrase was
  visibly worse than simply continuing the underline when margin air is clear.
- The middle shaft saved large amounts of ink, but screenshot 3 shows its
  staircase silhouette is not automatically beautiful. Disable or re-form it
  when it cannot use the same calm attachment grammar.
- Exact left/right mirroring and section-aware topology are worth keeping. The
  literal path silhouettes used to demonstrate them are not sacred.
- Numerical overengineering was removed during C0.4: ordinary finite numbers,
  forward accumulation, and one completed-route tenth-pixel comparison are
  sufficient. Keep that restraint.

## Worktrees and branches

| Worktree | Branch / head | State | Instruction |
|---|---|---|---|
| `/Users/jonnyroyal/dev/scripture-app` | `codex/smart-shapes`, implementation baseline `6bd0959` | Clean before this documentation-only handoff; at the baseline, 3 commits ahead of `codex/pattern-shapes` and 94 ahead of local/cached `main`; no upstream configured | This is the authoritative Smart Shapes continuation. |
| `/Users/jonnyroyal/dev/scripture-app-shapes` | `codex/pattern-shapes` @ `439c603` | **Dirty:** uncommitted `lab/lab.js` rewrite, 117 insertions / 139 deletions | Preserve exactly. Do not reset, clean, remove, or treat it as C0.2–C0.4 truth. Inspect only if the rewrite becomes relevant. |
| `/Users/jonnyroyal/dev/scripture-app-mobile` | `codex/mobile-web-pwa` @ `d62a03a` | Clean and unrelated | Do not touch for this work. |

Local `main` is `f420855`; `codex/prototype-snapshot` is `06d61da`. The active
Smart Shapes branch descends from the prototype and contains the app source,
but none of C0.2–C0.4 changed `src/core`, `src/renderer`, or `src/host`. The
Smart Shapes head is not present in a cached remote-tracking branch.

## Code map

- [`lab/route-engine.js`](lab/route-engine.js) — current pure JavaScript
  geometry engine. Relevant seams are `quarterVH` / `quarterHV`, `pinOf`, the
  cradle branch, margin generation, and `makeHandoff`.
- [`lab/route-lab.js`](lab/route-lab.js) — measurement, visible fixtures,
  rendering, host validation, and exhaustive query gates.
- [`lab/lab.js`](lab/lab.js) — Shapes host. `ribbonDraw` is the current animated
  paint; `drawRouted` consumes canonical route parts. Reading mode still uses
  the older local bow geometry.
- [`lab/PROMPT-loom.md`](lab/PROMPT-loom.md) — chronological routing contract
  and lessons. Read later sections as amendments to earlier ones.
- [`lab/PLAN-semantic-routing.md`](lab/PLAN-semantic-routing.md) — completed
  adoption plan and “Later” list. Its old worktree path and dormant-left-only
  summary are stale; C0.3/C0.4 supersede them.
- [`tasks/C0.4-section-aware-handoffs.md`](tasks/C0.4-section-aware-handoffs.md)
  — sealed C0.4 contract and verification record.
- [`tests/route-engine-claims.test.ts`](tests/route-engine-claims.test.ts),
  [`tests/route-engine-bidirectional.test.ts`](tests/route-engine-bidirectional.test.ts),
  and [`tests/route-engine-sections.test.ts`](tests/route-engine-sections.test.ts)
  — direct engine contracts.

The current production app has no `planRoute`, Loom, Shapes, or Traces import.
For the clean main-app visual precedent, inspect
[`src/renderer/utils/highlightPath.ts`](src/renderer/utils/highlightPath.ts) and
[`src/renderer/components/HighlightUnderlay.tsx`](src/renderer/components/HighlightUnderlay.tsx).
Do not reuse their filled-highlight geometry for a connector; reuse their
discipline: pure measured geometry, one renderer adapter, compact eased turns,
and explicit rejection of broad decorative S-curves.

Production [`src/renderer/components/ScripturePage.tsx`](src/renderer/components/ScripturePage.tsx)
currently owns the verse canvas and mounts `HighlightUnderlay`; `LivingMargin`
is a sibling panel, not a line destination in a shared overlay. The app does
not yet reserve left/right loom air or expose one coordinate space spanning the
reading canvas and margin. Its durable `AnchorRecord` is verse-level, and the
available character-offset overlay data does not describe multi-anchor
relations. `ChapterData` also carries no explicit semantic sections or clear
gaps. Therefore an initial app-host proof must keep section handoffs dormant
unless real section metadata is supplied; it must never infer sections from
paragraph appearance or reflow.

For line paint, the portable lab seams are `ribbonOutline`, `ribbonDraw`,
`segPtsFor`, `drawRouted`, continuation contacts, and weave-state construction
in `lab/lab.js`. Move the small typed equivalents into a dedicated React
connector overlay rather than folding them into the filled-highlight underlay.
Reuse the production underlay's font-ready / `ResizeObserver` lifecycle, and
port the final-weave-before-claim invariant—not the hidden QA DOM or fixture
datasets.

## Explicitly unfinished

1. **Calm terminal and handoff grammar.** This is now the blocker before the
   app port. The current engine is functionally correct but visually unapproved
   in the four cases above.
2. **Strict TypeScript pure-engine port.** No app-port task exists yet. Keep the
   engine platform-agnostic under `src/core` with no DOM, Node, or Electron
   imports, and add one renderer/measurement adapter rather than porting lab
   instrumentation.
3. **Reading-canvas and passage-score integration.** Not started. Shapes and
   Route Lab are prototypes, not production renderer code. The app also needs
   a deliberate shared overlay/layout boundary that reserves safe loom air on
   both sides without invading the Living Margin.
4. **Durable translation-safe anchors and events.** Not started for Smart
   Shapes. Store Backbone coordinates, not translation tokens; all explicit
   user mutations must flow through the broker/RevisionStore and append-only
   event contracts.
5. **Later polish:** word-run cradle depth, previous-line wrap-facing cradles,
   and a route-faithful export miniature remain recorded rather than silently
   expanded into the next gate.

## Recommended next bounded task

Create one task, tentatively **C0.5 — Calm terminal and handoff grammar**, on the
clean `codex/smart-shapes` worktree. Do not start by porting or rewriting the
solver.

1. Preserve the current C0.3/C0.4 route-choice and ownership projections as
   oracles.
2. Add the four screenshot cases as the smallest visible fixture sheet.
3. Replace only the endpoint/turn/handoff primitives necessary to produce the
   visual grammar above. Keep left/right as an exact mirror.
4. First review at reading scale and roughly 2.4× zoom. Iterate until the line
   is boring and clean.
5. Then run narrow/wide reflow, all four atmospheres, hard-clearance checks,
   deterministic repeats, held-tick behavior, and the full suite.
6. Record any intentional oracle/digest change explicitly. Never make a failing
   screenshot “pass” by relaxing ink clearance.
7. Once the user approves the silhouette, freeze that smaller geometry contract
   and begin the strict TypeScript/app-host port as the next separate task.

### Visual acceptance for C0.5

- every phrase dot has a visibly straight, colinear horizontal contact lead;
- an upper endpoint leaves level before turning down;
- a lower endpoint approaches from below, rounds up, and finishes level;
- same-line terminals are true reflected constructions with a real flat floor;
- left and right margin fixtures are exact mirrors;
- a section switch stays wholly inside a declared clear gap, crosses nearly
  flat, and contains no central vertical jog;
- kind/hue changes never alter centerline geometry;
- no malformed path, clipping, prose/number crossing, overflow, focus loss, or
  browser error at 460–760, 640, and 1280 across all four atmospheres;
- when the clean silhouette is illegal, the engine chooses a legal whole-side
  route or reports `needs-space`.

## Candid final read

The exploration was good and most of it should survive. Claim precision,
bidirectional scoring, semantic sections, deterministic topology, ownership,
weaving, held disclosure, and performance are real accomplishments. The pause
is about taste at the last inch: the connector still advertises how it was
constructed. Fix that small visual grammar before carrying the system into the
app.
