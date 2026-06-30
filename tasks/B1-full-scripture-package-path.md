# TASK B1: Full Scripture Package Path - L1 -> L3

PRECONDITION: A0 and A1 complete.

READ: spec §4.1, §4.7, §6 M0/M1; `AGENTS.md` INV-3, INV-5, INV-6, INV-17; `STATUS.md` row "Scripture data WEB/KJV".

CURRENT STATE: partial seeded WEB demo verses exist. Full WEB/KJV package coverage, package manifests, license checks, and version refusal behavior are not complete.

## Scope

- Produce or import full WEB and KJV package data behind the §4.7 `ScripturePackage` manifest shape.
- Ensure every rendered verse validates against `backbone.json` and uses USFM 3-letter book codes.
- Fill license permission flags and attribution for shipped text packages.
- Implement package version/refusal behavior: newer library/package format must refuse safely rather than parse best-effort.
- Extend Doctor checks for package license fields and missing package content.

## Out Of Scope

- Original-language packages.
- Morphology or alignment UI.
- AI, embeddings, semantic search over Scripture text.
- Sync UX.

## Done When

- Reader can render any WEB verse across all 66 Protestant books.
- Reader can render any KJV verse across all 66 Protestant books.
- Package manifests include required license flags and attribution.
- A newer unsupported package/library format triggers refusal with a clear user-facing path, not best-effort parsing.
- `library doctor` reports no missing package license fields on the installed WEB/KJV packages.
- `LICENSES.md` covers the shipped package data.

## Stop If

- A shipped text cannot be confirmed to permit bundle, index, display, quote in notes, export, and own-device sync as required by the package policy.
- A versification mismatch would require storing translation-specific anchors.

## Touches

- `data/scripture/`
- `LICENSES.md`
- `src/core/reference/`
- `src/host/library.ts`
- `src/renderer/components/ScripturePage.tsx`
- `src/core/doctor/`
- Verification scripts under `scripts/`

## On Completion

- Update `STATUS.md` row "Scripture data WEB/KJV" Cur -> L3.
- Commit with message `feat: add full scripture package path`.
