# TASK A1: Stabilize Native Build And Lint - L1 -> L2

PRECONDITION: A0 is complete and committed on `codex/prototype-snapshot`.

READ: spec §5; `AGENTS.md` INV-18; `STATUS.md` rows "Electron shell + launch" and "CI / native rebuild / lint".

CURRENT STATE: Electron launches only after manually rebuilding `better-sqlite3` for Electron ABI 133. Node 24 verification needs ABI 137. `npm run lint` can wedge in this environment.

## Scope

- Add explicit package scripts for rebuilding native modules for Electron runtime and Node verification runtime.
- Document the ABI split in a short developer note.
- Make the app start command fail visibly if native module ABI is wrong.
- Stabilize or replace the lint command so the expected typecheck path is reproducible.

## Out Of Scope

- Feature work.
- UI redesign.
- Changing `better-sqlite3` to another SQLite binding unless the current binding cannot be scripted.
- Changing core contracts or moving Node imports into `src/core/`.

## Done When

- A clean checkout can run one documented command to prepare Electron runtime native modules.
- A clean checkout can run one documented command to prepare Node-side verification native modules.
- Electron start path loads `better-sqlite3` without ABI mismatch.
- Node-side verification path loads `better-sqlite3` without ABI mismatch.
- `npm test` passes.
- The chosen lint/typecheck command exits with status 0 or the task records a specific upstream/tooling blocker with a replacement command.

## Stop If

- The fix requires weakening TypeScript strictness.
- The fix requires committing `node_modules/` or compiled native binaries.
- The fix requires changing core architecture to avoid the native binding.

## Touches

- `package.json`
- `package-lock.json`
- `scripts/`
- `docs/`
- Possibly `tests/` for a native-runtime smoke test

## On Completion

- Update `STATUS.md` rows "Electron shell + launch" and "CI / native rebuild / lint".
- Commit with message `chore: stabilize native build workflow`.
