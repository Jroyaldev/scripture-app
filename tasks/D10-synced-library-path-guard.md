# TASK D10: Refuse a library on synced storage

STATUS: OPEN — raised 2026-07-28 from a live incident, not yet started.

## Objective

Stop the app from opening a library that lives inside a cloud-synced container.
SQLite is unsupported on synced and network filesystems because its locking
model depends on POSIX advisory locks the sync daemon does not honour. Today the
app opens such a library anyway and fails later in ways that name the wrong
culprit.

## Why this exists

On 2026-07-27 the library at `~/Desktop/Test` sat inside iCloud "Desktop &
Documents" sync. One cause produced three unrelated-looking failures, each of
which cost real diagnostic time:

- `SqliteError: disk I/O error` — iCloud created conflict copies
  (`embeddings 2.sqlite-shm`) while SQLite held the originals.
- `EINTR: interrupted system call, read` — reads blocked for *seconds* waiting
  on iCloud to materialise file data, which gives a signal time to land
  mid-syscall. Local reads finish in microseconds and are effectively never
  interrupted.
- Frozen splash, then "not responding" — `sample <pid>` showed 100% of 2454
  slices in `openDatabase (better_sqlite3.node) → pread`.

None of those messages points at the filesystem. The engine reported an
interruption as a library that cannot be opened.

The hazard is not one user's misplaced folder. `getLibraryPath` in
[main.ts:1700](src/electron/main.ts:1700) defaults to
`resolve(app.getPath("documents"), "ScriptureLibrary")`, and **`~/Documents` is
itself iCloud-synced whenever Desktop & Documents sync is on** — the default
setting on a signed-in Mac. A fresh install walks straight into this.

The relocation also cost the library's `.git` revision history: iCloud stalled
over 30 minutes on a single 92-byte object and never materialised `.git/HEAD`,
the refs, or the index, so the history could not be copied off. Refusing early
is what preserves the ability to move a library cleanly later.

## Scope

- Classify a candidate library path as synced before the engine touches it.
  On macOS the signals are containment in `~/Library/Mobile Documents`,
  containment in a `com~apple~CloudDocs` tree, a `Desktop`/`Documents` path
  whose real location resolves under the iCloud container, and the `dataless`
  file flag. Dropbox/OneDrive/Google Drive roots are the same class of hazard
  and should share one predicate.
- Gate both entry points in [main.ts](src/electron/main.ts): `getLibraryPath`
  ([1700](src/electron/main.ts:1700)) for the resolved path, and library
  creation near [2114](src/electron/main.ts:2114) so a new library is never
  *created* somewhere it cannot safely live.
- Refuse with a dialog that names the real problem and offers a safe location
  (`~/ScriptureLibrary`), rather than the current generic "The library engine
  could not start" at [3978](src/electron/main.ts:3978).
- Move the default off `Documents` to a path outside every synced container.
- Log the classification through `logLifecycle` so the JSONL at
  `~/Library/Logs/Pericope/` records *why* a path was refused.

## Out of scope

- Migrating an existing library automatically. Detection and refusal only; the
  user chooses when to move, because materialising an evicted tree can take an
  unbounded amount of time.
- Making SQLite work on synced storage. It does not, and no retry layer
  changes that.

## Relationship to the EINTR retries

`execFileSyncInterruptible` and `readFileSyncInterruptible` in
[exec-sync.ts](src/host/exec-sync.ts) are a correct and independent robustness
fix — Node does not retry EINTR for you, and Electron's main process is a bad
place to assume signals never land mid-syscall. Keep them. But they treat a
symptom: they turn a hard failure into a slow one. This task addresses the
cause. Do not let their presence argue that this guard is unnecessary.

## Verification

- Unit tests for the synced-path predicate: iCloud Mobile Documents, a
  `Desktop`/`Documents` path under Desktop & Documents sync, a plain local path
  (`~/ScriptureLibrary`) that must be allowed, and a symlink that resolves into
  a synced container.
- A refusal test proving the engine never constructs `Database` for a synced
  path — the guard must run before `openDatabase`, since that is the call that
  blocks.
- Contract test that the default library path is outside every synced container.
- `npm run lint`, Electron build, renderer build, full suite.

## Guardrails

- Detection is advisory about *location*, never about file contents.
- A false positive must be recoverable: the dialog offers an explicit override
  path, so an unusual-but-safe layout is not permanently locked out.
- No network calls and no sync-daemon mutation. `brctl` may be read for
  diagnostics but must never be required for the guard to function.
