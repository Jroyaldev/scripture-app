# D14 — Quire Magic visual grammar

## Objective

Make the isolated Tour Lab `/magic` performance follow the podcast more visibly without turning the
theater into a dashboard. Search/retrieval is frozen. Luna on OpenRouter remains the only model-backed
director; no Sol testing and no visualization skill are part of this task.

## User-visible outcome

- The stage changes when the teacher makes a grounded move: works inside a verse, translates a term,
  follows an allusion, compares or chains passages, corrects a reading, supplies context, or states a
  sentence worth holding.
- Context before the first passage can occupy a quiet, verse-less scene instead of leaving the theater
  blank.
- More visual beats arrive across time, but only a bounded set remains active: Scripture is the anchor;
  groups, micro-notes, supporting passages, asides, and highlights have house-owned lifetimes.
- Seeking, resize, mobile layout, reduced motion, and ordinary playback reconstruct the same active
  visual state at the same clip time.
- Every supported director artifact has a cost-free replay checkpoint. House-authored QA fixtures are
  labelled as such and never presented as Luna evidence.

## In scope

- `lab/tour-lab/server.mjs`: time-aware visual-direction prompt, mixed passage/context scenes, cadence
  fill knobs, and type-selection rubric.
- `lab/tour-lab/magic-contract.mjs`: scene ownership recovery, cadence metrics, and deterministic visual
  lifecycle helpers.
- `lab/tour-lab/magic.js`, `magic.html`, and `magic.css`: active-channel retirement, seek parity, and
  calmer narrow-layout group labels.
- Saved replay fixtures, focused offline contract tests, README, and `STATUS.md`.

## Out of scope

- Search ranking, retrieval, corpus indexing, or Tour Lab source selection.
- A main-renderer port.
- New artifact families, generative imagery, or model-authored CSS/SVG geometry.
- Paid acceptance calls. Existing Luna records may be audited; implementation verification is replayed
  locally with model routes unused.

## Acceptance

- All nine director artifact types are catalogued and represented by valid replay evidence or a clearly
  labelled house-QA fixture.
- A visual event has a deterministic channel and exit time; late-scene seek does not reconstruct every
  historical artifact.
- Narrow layout shares the support/micro slot and does not rotate group labels in the verse gutter.
- Prompt policy asks for the most specific transcript-supported type and conditional cadence rather than
  generic group coverage.
- Final normalization reports per-type counts and largest visual gap.
- Focused tests and replay browser checks make no model-route requests and pass at desktop and mobile
  widths.

## Status

Complete 2026-08-02.

- The visual inventory and evidence distribution are recorded in
  `lab/tour-lab/VISUAL_AUDIT.md`; search and retrieval were not changed.
- The cost-free `visual-artifact-atlas` replay validates all nine director artifact renderers and is
  explicitly marked `house-qa` with zero model passes, tokens, or cost.
- Deterministic channels, dwell limits, scene reassignment, context preludes, cadence measurements,
  seek reconstruction, and narrow-layout framing are implemented in the isolated Tour Lab.
- Focused contracts pass 12/12. The full suite reports 1,548 tests: 1,516 pass, 32 expected native ABI
  skips, and 0 failures. TypeScript lint, JavaScript syntax checks, and `git diff --check` are clean.
- Browser replay QA covered all nine artifacts at desktop and 390x844, normal replacement through the
  final empty state, zero horizontal overflow, and a clean console. Model-backed routes were unused.
- No acceptance call was purchased. The revised prompt's real Luna distribution, and real Luna examples
  of footnote, chain, and caveat, remain explicitly unproven until an organic future run.
