# Current State

Snapshot target branch: `codex/prototype-snapshot`

This snapshot preserves the current prototype as implemented from the frozen Scripture-Native Knowledge Library spec plus follow-up milestone work.

## Preserved Work

- M2 deterministic desktop shell and Living Margin work from the prior baseline.
- M3 AI/semantic plumbing proofs: budget manager, provider interfaces, embeddings store, claims/facts/overlays, semantic margin proof.
- M4 source ingestion proof: PDF import, source chunk records, locators, margin surfacing, pin snippet citation.
- M5 plugin proof: manifest validation, closed capabilities, broker, VM runtime proof, theme support, first-plugin guide.
- M6 sync proof: folder sync adapter, conflict copies, pointer-only licensed artifact sync, overlap Doctor warning.
- M7 groundwork only: non-Git snapshot `RevisionStore` adapter and focused test.

## Verification State

Last known successful verification before this snapshot:

- `npm test`: 3 tests passed.
- `npm run verify:m2`: 53/53 passed.
- `npm run verify:m3`: 44/44 passed.
- `npm run verify:m4`: 16/16 passed.
- `npm run verify:m5`: 12/12 passed.
- `npm run verify:m6`: 9/9 passed.
- Direct TypeScript compiler passes exited cleanly, while `npm run lint` can intermittently wedge.

Current native module state:

- `better-sqlite3` is rebuilt for Electron 35 / Node ABI 133 so the Electron app can launch.
- Node 24-side verification uses ABI 137 and may require rebuilding `better-sqlite3` back for Node before running milestone scripts.

## Known Stand-Ins

- Scripture data is partial demo data, not full WEB/KJV package coverage.
- AI and embeddings are deterministic/mock proofs, not production provider integrations.
- Plugin runtime is a brokered Node `vm` proof, not hardened isolation for untrusted third-party plugins.
- Sync is folder-to-folder proof, not product sync UX.
- PDF ingestion works at acceptance-script level but lacks full source shelf workflow.
- iOS is not started beyond the snapshot revision adapter.
