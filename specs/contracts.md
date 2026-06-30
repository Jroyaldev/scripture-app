# Contracts

This file is the frozen contract index for the current implementation. It references the original Scripture-Native Knowledge Library build specification rather than replacing it.

Do not re-architect these contracts during delivery tasks. If a contract appears wrong, stop and report the proposed amendment.

## Contract Index

| Section | Contract | Current repo areas |
|---|---|---|
| 4.1 | Reference strings and Resource IDs. Anchors store `bref:v1/...`; plugin-facing resources use `note:`, `source:`, `fact:`, `claim:`, and `bref:v1/...`. | `src/core/reference/`, `src/core/indexer/types.ts`, `src/core/plugins/` |
| 4.2 | `LibraryEvent` envelope and deterministic fold. Logs are append-only; fold never orders by wall-clock time. | `src/core/events/`, `src/host/sync.ts` |
| 4.3 | Library folder layout and buckets: Substrate, Installed Artifacts, Derived. `.system/`, `.artifacts/`, and source originals are not committed. | `src/host/library.ts`, `.gitignore` |
| 4.4 | SQLite is a materialized view. It is safe to delete and rebuild. | `src/host/sqlite.ts`, `src/core/indexer/` |
| 4.5 | `rebuild_hash` canonicalization excludes FTS and embeddings. | `src/core/indexer/hash.ts` |
| 4.6 | Markdown note format. File wins over `note-change-log.jsonl`; note identity is frontmatter ULID. | `src/core/notes/`, `src/host/library.ts` |
| 4.7 | Scripture package, backbone, versification maps, and license flags. | `data/scripture/`, `LICENSES.md` |
| 4.8 | Source rights and sync policy. Pinning a chunk copies quote plus locator into Substrate. | `src/core/sources/`, `src/host/pdf-source.ts`, `src/host/library.ts` |
| 4.9 | Plugin manifest, closed capabilities, default-deny broker, theme subclass. No `write:substrate`. | `src/core/plugins/`, `src/host/plugin-broker.ts`, `src/host/plugin-runtime.ts` |
| 4.10 | Budget Envelope plus AI and embedding interfaces. Background AI/network are bounded. | `src/core/ai/`, `src/host/budget-manager.ts`, `src/host/ai-provider.ts` |
| 4.11 | `RevisionStore` interface and adapters. Git is desktop-only; non-Git platforms use `.history/` snapshots. | `src/core/interfaces.ts`, `src/host/git-revision-store.ts`, `src/host/snapshot-revision-store.ts` |

## Delivery Rule

Task specs in `tasks/` may reference these contracts by section. They must not restate or mutate them unless the task is explicitly a contract amendment.
