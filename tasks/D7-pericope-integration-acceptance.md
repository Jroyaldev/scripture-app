# TASK D7: Pericope integration live acceptance

STATUS: COMPLETE — the integrated Smart Shapes desktop passes isolated live Electron acceptance.

## Objective

Close the integration with one repeatable, profile-isolated live gate covering
the Pericope startup contract, six-theme persistence, Smart Shapes interaction
ownership, and real local trusted-resource rendering.

## Landed

- Added `qa:pericope-integration`, which launches a fresh temporary Electron
  profile and library without touching the user's profile or authored data.
- Proved the branded first-run and successful-load splash holds, explicit
  library confirmation, all six persisted themes, Onyx dark-material behavior
  after reload, three-source local IPC results, one-featured/two-compact cards,
  no dead Save control, and no runtime request to any resource publisher.
- Hardened the permanent Smart Shapes interaction gate with failure-layer and
  Escape-owner diagnostics plus stale-artifact cleanup after a green rerun.
- Fixed three real ownership races exposed by that gate: stale selected-shape
  capture after dismissal, hidden marking/legacy palette state taking Focus
  mode's next Escape, and an invisible hover preview taking the same Escape.
- Released the browser-native text Range when marking chrome is dismissed while
  preserving the internal passage scope, so the next connected-word click is
  not misclassified as another completed drag.

## Verification

- `qa:reading-interactions`: 8/8 Palette/Rail/Radial/Dock x 390/860 cells;
  exact overlap, dense chooser, Focus Escape ladder, coarse tick overflow, and
  authored JSONL byte integrity all pass.
- `qa:pericope-integration`: first-run splash 2711 ms, successful-load splash
  2831 ms, six themes, three real trusted-resource cards, zero publisher
  runtime requests.
- Focused reading-interaction contracts: 20/20.
- Full suite: 746 total, 717 passed, 29 expected Electron-ABI skips, 0 failed.
- `npm run lint`, Electron build, renderer build, and `git diff --check`: pass.

## Guardrails

- No user profile, library, or authored data is used by either isolated gate.
- Dismissal never implies Release and never appends or rewrites authored JSONL.
- The trusted-resource live gate does not open an outbound link.
