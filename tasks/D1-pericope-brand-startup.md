# TASK D1: Pericope identity and startup isolation

STATUS: COMPLETE.

## Objective

Port the committed Pericope identity onto the Smart Shapes checkpoint without
merging the divergent desktop renderer, and isolate settings from the generic
Electron development profile.

## Delivered contract

- Pericope names the desktop shell, renderer, onboarding, CLI, About surface,
  and library Git identity; frozen library schema identifiers are unchanged.
- `app.setName("Pericope")` runs before any Electron path lookup or store.
- Legacy settings are adopted only when the dedicated profile is absent and a
  strict whitelist recognizes valid app-owned values. The source is untouched.
- Successful and first-run loads hold the branded splash for at least 2.4s;
  error states remain immediate.
- A fresh profile creates no library until the user explicitly confirms it.

## Verification

- Focused legacy-settings and startup contracts.
- Full lint, test, renderer build, Electron build, and diff-integrity gates.
