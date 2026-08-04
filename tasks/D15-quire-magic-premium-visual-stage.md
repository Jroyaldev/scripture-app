# D15 — Quire Magic premium visual stage

## Objective

Rebuild the isolated Tour Lab `/magic` visual performance as one coherent, premium system. Scripture
remains the stable anchor; the current podcast thought appears as a deliberately composed relationship,
not as a random margin mark, generic card stack, or detached metadata line.

## User-visible outcome

- The loom visibly gathers its selected words into one relationship. Its label never overlaps geometry,
  never floats in a disconnected margin, and remains attached to the relationship on narrow screens.
- Spoken word lights culminate in the loom instead of being replaced by visually equivalent underlines.
- Term and footnote visibly attach to the word they explain.
- Chain depicts progression through passages with clear nodes, direction, and a restrained endpoint.
- Compare names and depicts its likeness/difference axis.
- All transient artifacts occupy one stable current-thought region beneath Scripture. A new thought
  replaces the prior composition without vertical teleporting between fixed type bands.
- The complete stage shares one spacing, type, border, color, motion, and responsive grammar; premium
  means intentional hierarchy and semantic clarity, not added decoration.

## In scope

- `lab/tour-lab/magic.html`, `magic.css`, and `magic.js` rendering and orchestration.
- Pure geometry/lifecycle helpers in `magic-contract.mjs` where they improve deterministic testability.
- Cost-free replay fixtures and focused tests for geometry, semantic variants, exclusivity, and seek
  reconstruction.
- Desktop and mobile replay QA, including screenshot comparison against the D14 audit baseline.
- Tour Lab README, audit note, task status, and `STATUS.md` when acceptance is complete.

## Out of scope

- Search, retrieval, corpus ranking, or model prompt changes.
- New OpenRouter calls or Sol testing. Existing house-QA and paid Luna evidence are sufficient.
- A main-renderer port or changes to the separate Listen room.
- Generative imagery or model-authored geometry.

## Acceptance

- Same-line, multi-line, wrapped, repeated-word, punctuation-normalized, and narrow loom cases render one
  connected relationship with a measured non-overlapping label.
- The stage does not reserve a permanent desktop loom gutter when no loom is active.
- One transient current-thought host renders term, footnote, allusion, compare, chain, caveat, or aside;
  only the currently active composition is visible.
- Highlight remains exclusive for its complete media-time dwell.
- Chain remains above the caption/control reserve without requiring page-level horizontal overflow or a
  nearly full-screen text stack.
- The atlas screenshots every supported renderer at desktop; loom, chain, term, footnote, and compare
  also pass narrow viewport review.
- Focused contracts, lint, syntax, diff integrity, and the full test suite pass without model-route use.

## Status

Complete 2026-08-02.

Proof:

- The checked-in house-QA atlas renders all nine artifact families at 1280×720; loom, footnote, term,
  compare, and chain also pass at 390×844. Every sampled beat has exactly one current composition and
  zero horizontal overflow.
- Two real-replay loom cases cover punctuation-normalized anchors and a narrow wrapped two-line weave.
  Both retain a measured title, all contacts, a continuous warp, and one weft per participating line.
- Highlight is exclusive, word cues lead into rather than stack beneath a completed thought, and seek
  reconstruction uses the same media-time projection as playback.
- `node --check lab/tour-lab/magic.js`, lint, and diff integrity pass. Focused contracts pass 14/14. The
  full suite reports 1,553 tests / 1,521 pass / 32 expected ABI skips / 0 fail.
- D15 made no provider request and did not change search, retrieval, prompts, or model routing.
