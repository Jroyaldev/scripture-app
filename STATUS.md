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
| Electron shell + launch | L2 | L3 | App launches after `npm run rebuild:electron`; `npm start` runs an Electron-runtime preflight that fails visibly with an actionable message on ABI mismatch; `main.ts` also guards direct `electron` invocation with a dialog. |
| Library folder layout | L2 | L3 | Matches contract shape; needs package/version refusal hardening. |
| Notes / anchors / highlights / deterministic Living Margin | L1-L2 | L3 | Highlight create/delete uses incremental SQLite; palette now dismisses optimistically before persistence; broader restore/safety UX still needs hardening. |
| M3 AI plumbing | L2 | L2-L3 | B3 Gates 1-2 landed + Gate 3 contract proven live: real DeepSeek LLM path (`deepseek-v4-flash`, latency classes, JSON mode) AND real local embeddings (EmbeddingGemma-300m ONNX q8, asymmetric prefixes, incremental content-hash sync, model-switch invalidation) now power the semantic margin — `deterministicEmbedding` is test-only. Claim-extraction contract (`claims-v1`, strict validation, mandatory evidence) proven live: 5/5 grounded claims from seeded notes surfaced through the margin query path. Remaining: extraction as background jobs (Gate 3), margin truthfulness/AI-insight (Gate 4), budget semantics (Gate 5), rebuild + in-app acceptance (Gate 6). See `tasks/B3-real-ai-and-embeddings.md`. |
| M4 source ingestion | L1-L2 | L2-L3 | PDF import/chunk/locator path passes gate; source shelf/workflow is minimal. |
| M5 plugin broker / manifest / theme | L1 | L3 | Default-deny proof exists; Node `vm` sandbox is not hardened enough for third-party plugins. |
| M6 sync | L1 | L3 | Folder-to-folder proof exists; not a real device/cloud sync UX. |
| Desktop Git RevisionStore | L1-L2 | L3 | Works as adapter proof; needs safer restore UX and operational guardrails. |
| Non-Git snapshot RevisionStore | L1 | L1 | Groundwork for iOS/mobile exists; retention pruning and UI are not implemented. |
| iOS client | L0 | L0 deferred | No iOS project/toolchain setup. Do not start before Tier B/C maturity improves. |
| Scripture data WEB/KJV | L3 | L3 | Full WEB + KJV across all 66 books (1189 chapters each, 2378 files); package manifests with license flags + formatVersion; Doctor checks for version refusal + missing content; LICENSES.md covers both sources. |
| App UX / onboarding / settings / error states | L1-L2 | L2-L3 | B2 in progress: full read-screen redesign landed (collapsible sidebar + library popover, passage/version picker popovers, gradient-wash verse highlights with pinned-passage model, Living Margin 3-state incl. ambient IntersectionObserver reading + per-verse AI insight cache, dark mode + electron-store-persisted settings), live-QA'd via CDP against the running app with real bugs found and fixed (settings self-revert race, Popover viewport clamping, dark-mode toast contrast, stale cross-chapter verse selection). Onboarding/library-picker first-run flow and source/sync surfaces still need deliberate work — biggest remaining B2 gap. |
| CI / native rebuild / lint | L2 | L2 | Two explicit commands (`rebuild:node` / `rebuild:electron`) cover the ABI 137/133 split; `npm run lint` reproducible (exit 0); `npm test` ABI-independent (8/8); preflight gates Electron launch. See `docs/native-build.md`. CI matrix not yet configured. |

## Sequenced Backlog

1. **A0 Snapshot current prototype:** preserve the dirty tree on a branch, ignore noise, commit non-noise work, and document current state.
2. **A1 Stabilize native build and lint:** make Electron and Node-side verification reproducible without manual ABI rebuilds. — **DONE** (see `docs/native-build.md`; `rebuild:node`/`rebuild:electron` + Electron preflight).
3. **B1 Full scripture package path:** promote WEB/KJV data from partial demo to real package coverage and refusal behavior. — **DONE** (1189 chapters × 2 translations; manifests + version refusal + Doctor content checks).
4. **B2 App UX pass:** onboarding, library picker, loading/error states, settings, source/import screens, sync status.
5. **B3 Real AI and embeddings:** BYOK/local provider flow, real embeddings, queue/retry/error handling. — **IN PROGRESS** (Gates 1-2 of 6 done, Gate 3 contract proven live; staged plan in `tasks/B3-real-ai-and-embeddings.md`).
6. **B4 Production rebuild story:** delete `.system/` and rebuild source chunks/indexes/embeddings deterministically.
7. **C1 Revision safety:** safe restore UX and data-loss guardrails.
8. **C2 Real sync UX:** provider choice, device identity, conflict UI, progress, license enforcement.
9. **C3 Plugin isolation L3:** process isolation or equivalent before third-party plugins.
10. **D1 iOS:** deferred until the desktop daily-use path is substantially real.
