# Status

This is the living delivery ledger. The build specification and `AGENTS.md` remain the frozen source of truth for invariants and contracts.

## Maturity Rubric

- **L0 - Absent:** not started.
- **L1 - Proof / gate-complete:** exists and passes a focused gate; mocks or happy-path flows may remain.
- **L2 - Functional:** real implementation on realistic data; edge cases, UX, and operations may still be thin.
- **L3 - Production:** hardened, recoverable, tested, and safe for target users.

## Current Ledger

| Component | Cur | Target | Current read / gap |
|---|---:|---:|---|
| Repo hygiene / snapshot | L2 | L2 | Dirty prototype is being preserved on `codex/prototype-snapshot`; `.DS_Store` noise ignored. |
| Reference / anchor / `bref` model | L2 | L3 | Real core exists; needs broader package/data coverage and regression tests. |
| Electron shell + launch | L2 | L3 | App launches after rebuilding `better-sqlite3` for Electron ABI 133; rebuild workflow is manual. |
| Library folder layout | L2 | L3 | Matches contract shape; needs package/version refusal hardening. |
| Notes / anchors / highlights / deterministic Living Margin | L1-L2 | L3 | Flows exist and M2 gate passed; UX and error states are thin. |
| M3 AI plumbing | L1 | L2-L3 | Broker, budgets, embeddings store, claims/facts/overlays exist; AI and embeddings are mock/deterministic. |
| M4 source ingestion | L1-L2 | L2-L3 | PDF import/chunk/locator path passes gate; source shelf/workflow is minimal. |
| M5 plugin broker / manifest / theme | L1 | L3 | Default-deny proof exists; Node `vm` sandbox is not hardened enough for third-party plugins. |
| M6 sync | L1 | L3 | Folder-to-folder proof exists; not a real device/cloud sync UX. |
| Desktop Git RevisionStore | L1-L2 | L3 | Works as adapter proof; needs safer restore UX and operational guardrails. |
| Non-Git snapshot RevisionStore | L1 | L1 | Groundwork for iOS/mobile exists; retention pruning and UI are not implemented. |
| iOS client | L0 | L0 deferred | No iOS project/toolchain setup. Do not start before Tier B/C maturity improves. |
| Scripture data WEB/KJV | L1 | L3 | Partial seeded demo verses exist; full package coverage, manifests, and refusal behavior remain. |
| App UX / onboarding / settings / error states | L0-L1 | L2-L3 | Main flows exist, but loading/error/library picker/settings/sync surfaces need deliberate work. |
| CI / native rebuild / lint | L1 | L2 | ABI flip-flop is manual: Electron ABI 133 vs Node 24 ABI 137. `npm run lint` can wedge in this environment. |

## Sequenced Backlog

1. **A0 Snapshot current prototype:** preserve the dirty tree on a branch, ignore noise, commit non-noise work, and document current state.
2. **A1 Stabilize native build and lint:** make Electron and Node-side verification reproducible without manual ABI rebuilds.
3. **B1 Full scripture package path:** promote WEB/KJV data from partial demo to real package coverage and refusal behavior.
4. **B2 App UX pass:** onboarding, library picker, loading/error states, settings, source/import screens, sync status.
5. **B3 Real AI and embeddings:** BYOK/local provider flow, real embeddings, sqlite-vec, queue/retry/error handling.
6. **B4 Production rebuild story:** delete `.system/` and rebuild source chunks/indexes/embeddings deterministically.
7. **C1 Revision safety:** safe restore UX and data-loss guardrails.
8. **C2 Real sync UX:** provider choice, device identity, conflict UI, progress, license enforcement.
9. **C3 Plugin isolation L3:** process isolation or equivalent before third-party plugins.
10. **D1 iOS:** deferred until the desktop daily-use path is substantially real.
