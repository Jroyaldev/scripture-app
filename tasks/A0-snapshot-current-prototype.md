# TASK A0: Snapshot Current Prototype - dirty tree -> preserved branch

STATUS: completed in this snapshot commit.

PRECONDITION: `main` tracks `origin/main`; milestone work exists as an uncommitted dirty tree.

READ: `AGENTS.md`; `STATUS.md` rows "Repo hygiene / snapshot" and "CI / native rebuild / lint".

CURRENT STATE: M3-M6 plus M7 groundwork exist in the working tree but were not committed to GitHub.

## Scope

- Create a branch for the current prototype.
- Ignore `.DS_Store` noise.
- Commit all non-noise source, data, docs, scripts, and tests that make up the current prototype.
- Record what was captured in `CURRENT_STATE.md`.

## Out Of Scope

- Refactors.
- Feature fixes.
- Re-running or changing milestone gates.
- Rebuilding architecture or replacing the frozen spec.

## Done When

- Branch exists: `codex/prototype-snapshot`.
- `.gitignore` ignores `.DS_Store`.
- `CURRENT_STATE.md` exists.
- Non-noise work is committed.
- `git status --short` is clean after commit.

## Stop If

- Git refuses to create the branch.
- Any file appears to contain credentials or private secrets.
- A tracked binary source original would be committed.

## Touches

- `.gitignore`
- `CURRENT_STATE.md`
- Existing dirty prototype files
- Delivery docs and task files

## On Completion

- Update `STATUS.md` row "Repo hygiene / snapshot".
- Use the resulting branch as the reviewable base for A1.
