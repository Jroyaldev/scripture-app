# Agent Instructions

> Read this file first. It contains the invariants and conventions that govern all code in this repo.

## Operating Mode

- The original Scripture-Native Knowledge Library build spec is frozen source-of-truth.
- Do not replace the spec with a new greenfield brief. Amend contracts only when the human explicitly decides to change them.
- Delivery work is tracked in `STATUS.md` and one task file under `tasks/`.
- An implementation agent should read this file plus exactly one task file, then update `STATUS.md` when that task lands.
- Promote one component from its current maturity level to its target level per session. Do not broaden a task into adjacent components.

## Stack

- **Language:** TypeScript everywhere. Core obeys INV-18 (no Node/Electron imports; I/O injected).
- **Desktop shell:** Electron (future).
- **SQLite:** better-sqlite3. Vector search via sqlite-vec (future).
- **License:** Core = Apache-2.0. Plugin SDK/API = MIT or Apache-2.0.
- **Conventions:** TypeScript strict mode. No `any` in core. Errors are typed values, not thrown strings.

## Invariants (never violate)

### Ownership & trust
- **INV-1** — System, AI, and plugins MUST NOT write Substrate autonomously. Substrate writes occur only from explicit user actions through the broker.
- **INV-2** — Derived data MUST be fully regenerable from Substrate + Installed Artifacts. Deleting Derived and rebuilding MUST produce identical logical state.
- **INV-3** — Canon / Reference Data is read-only. Never mutated by app, AI, or plugins.
- **INV-4** — Authored data MUST NEVER be destroyed by a merge or sync.

### References
- **INV-5** — Anchors MUST store translation-free Backbone coordinates (bref:v1/...). Translation is a render request, never stored on an anchor.
- **INV-6** — Book codes MUST be USFM 3-letter uppercase. Coordinates MUST validate against backbone.json.

### Events & determinism
- **INV-7** — Event logs are append-only. No line is ever edited or removed.
- **INV-8** — Folding MUST NOT order by wall-clock time. Order: causal (baseEventId) -> deterministic tie-break (deviceId, seq, eventId).
- **INV-9** — SQLite is a materialized view, never source of truth. Safe to delete and rebuild at any moment.
- **INV-10** — rebuild_hash excludes FTS5 and embeddings.
- **INV-11** — For Notes, the Markdown file is authoritative. note-change-log.jsonl is index/recency only. File wins unconditionally.

### Revision & history
- **INV-12** — All Substrate mutation flows through RevisionStore. Git is desktop adapter only. Core/plugins/mobile MUST NOT assume Git exists.
- **INV-13** — Binary source originals MUST NOT be committed to Git.

### Plugins & security
- **INV-14** — Default-deny. No declared capability = no access. All access through the Capability Broker.
- **INV-15** — No autonomous write:substrate capability. Themes are tokens/CSS only.
- **INV-16** — Background AI and network bounded by the Budget Envelope.

### Versioning
- **INV-17** — Every durable Substrate format carries a version. Version bump ships migration or refusal mode. Newer library than app = refusal.

### Architecture
- **INV-18** — Core is pure platform-agnostic TypeScript with zero Node/Electron imports. All I/O injected behind interfaces.
- **INV-19** — Core app license = Apache-2.0. Plugin SDK/API = permissive (MIT or Apache-2.0).

## Directory Structure

```
src/core/       — Pure platform-agnostic TypeScript (INV-18). No Node imports.
src/host/       — Node-specific implementations (SQLite, file I/O).
src/cli/        — CLI entry point.
data/           — Static data (backbone, book names, versification maps).
specs/          — Contracts and milestone specs.
tests/          — Test files.
```

## Key contracts

- Reference strings: bref:v1/BOOK.chapter.verse (§4.1)
- Event envelope: LibraryEvent with ULID eventId, causal ordering (§4.2)
- Folder layout: Library/ with notes/, annotations/, sources/, config/ (§4.3)
- SQLite schema: §4.4 — materialized view, DROP AND REBUILD AT WILL
- rebuild_hash: SHA-256 of canonicalized logical state (§4.5)
- Note format: Markdown with ULID in frontmatter, [[note:ULID|label]] links (§4.6)
- Full contract index: `specs/contracts.md`
