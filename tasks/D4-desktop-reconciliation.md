# TASK D4: Reconcile the settled desktop checkpoint with Smart Shapes

STATUS: IN PROGRESS — Steps 1–2 complete; Steps 3–5 pending.

## Objective

Port the five settled B7 desktop slices onto the sealed Smart Shapes renderer
without replacing its application, reader, margin, or stylesheet wholesale.
The old `489c478` checkpoint is requirements evidence only.

## Sequence

1. Truthful Living Margin names/scope/counts, keyboard domains, shortcuts,
   focus movement, and accessibility.
2. Explicit research-to-note capture plus note lifecycle and draft recovery.
3. Browser-style canvas history and exact eye-line restoration.
4. Persisted, bounded research breadcrumbs with named Back/Close and focus
   restoration.
5. One explicit kept context plus VersePeek, without changing Smart Shapes
   selection, navigation, or marking-surface ownership.

## Landed

- Step 1: final lens names, readable scope states, honest bounded counts,
  multi-verse Words choice, removal of the duplicate margin color palette and
  silent language-study lock, canvas-versus-tab keyboard separation,
  panel descent/return, F6 pane movement, a modal shortcuts reference, and
  visible-text/focus-restoration accessibility fixes.
- Step 2: in-place note edit, guarded delete with byte-exact non-overwriting
  Undo, Git-backed tracked deletion, quoted-title round trips, recoverable
  full-Write drafts, and explicit-save Living Margin capture for related
  verses, note-derived references, passage insight, entity research, and word
  study. Captured excerpts retain visible source and frozen study provenance;
  public-data surfaces consolidate attribution under keyboard-accessible
  Sources/Cite disclosures.

Step 1 verification: focused contract 4/4; full suite 703 total, 674 pass,
29 expected Electron-ABI skips; lint, renderer/Electron builds, and diff
integrity clean.

Step 2 verification: focused note/Git/capture/workspace contracts 15/15; full
suite 715 total, 686 pass, 29 expected Electron-ABI skips; lint,
renderer/Electron builds, and diff integrity clean.

## Guardrails

- Preserve the current Smart Shapes selection and relationship-routing model.
- Never import the checkpoint renderer files wholesale.
- Keep authored writes explicit and broker-routed.
- Keep canvas history separate from research history.
