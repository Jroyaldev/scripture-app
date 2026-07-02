# Native Build & ABI Split

> Task A1 — stabilizing the `better-sqlite3` native rebuild workflow.

## The problem

`better-sqlite3` is a native Node addon. Its compiled `.node` binary targets
exactly **one** `NODE_MODULE_VERSION` (ABI) at a time. This repo runs the same
binary under two different runtimes:

| Runtime | ABI | Used by |
|---|---|---|
| Electron 35 | **133** | `npm start` / `npm run electron` (the desktop app) |
| Node 24 | **137** | `npm test`, `npm run verify:m2`…`verify:m6`, `npm run library` |

A single binary cannot satisfy both. Rebuilding for one runtime breaks the
other. This is inherent to native addons, not a bug — A1 makes the split
explicit, scripted, and visible instead of manual and silent.

## The two commands

```bash
# Build better-sqlite3 for the Node verification runtime (ABI 137).
# Run this before: npm test, npm run verify:m2 .. verify:m6, npm run library
npm run rebuild:node

# Build better-sqlite3 for the Electron runtime (ABI 133).
# Run this before: npm start, npm run electron
npm run rebuild:electron
```

- `rebuild:node`   → `npm rebuild better-sqlite3`
- `rebuild:electron` → `node scripts/rebuild-electron-native.cjs`

The Electron rebuild script calls the repo-local `node-gyp` directly inside
`node_modules/better-sqlite3` with Electron 35 headers. This avoids the broader
`electron-rebuild` dependency-tree walk, which can stall before compilation in
large or slow worktrees.

After a clean `npm install`, `better-sqlite3` is built for the **current Node**
ABI by default, so `npm test` and the verify scripts work out of the box. Switch
to Electron only when you want to launch the desktop app.

## Visible failure

`npm start` runs `npm run preflight:electron` before launching Electron. The
preflight (`scripts/preflight-native.cjs`) loads `better-sqlite3` under the
Electron runtime and exits with an actionable message on ABI mismatch:

```
preflight: FAILED to load better-sqlite3 under the Electron runtime.
Fix: npm run rebuild:electron
```

As a second layer, `src/electron/main.ts` probes the native module in
`app.whenReady()` before initializing the library. If the binary is wrong, it
shows an Electron error dialog (`dialog.showErrorBox`) with the same fix
command and quits — so direct `npm run electron` (bypassing `npm start`) also
fails visibly instead of crashing opaquely.

## Lint / typecheck

`npm run lint` runs both TypeScript passes:

- `tsc --noEmit`                       (core + host + cli + electron, `tsconfig.json`)
- `tsc --noEmit -p tsconfig.renderer.json` (renderer)

Both complete cleanly and reproducibly. The two halves are also exposed
directly as `npm run typecheck` and `npm run typecheck:renderer` for faster
iteration. The earlier "lint can wedge" symptom was not reproducible against
the current toolchain (`typescript@5.8.3`); it was traced to an
`electron --version` GUI hang in a prior environment, not to `tsc`.

## Why not auto-rebuild inside `npm start`?

Auto-rebuilding for Electron inside `npm start` would silently flip the ABI
from Node to Electron, which would then break `npm test` and the verify scripts
on the next run. The task contract (A1) calls for **two explicit commands** and
**visible failure**, so the start path fails fast with instructions rather than
mutating the native binary behind your back.

## CI notes

A CI matrix should run two jobs:

1. **node-verify** — `npm ci && npm run lint && npm test && npm run rebuild:node && npm run verify:m2 …`
2. **electron-launch** — `npm ci && npm run build && npm run build:renderer && npm run rebuild:electron && npm run preflight:electron`

The preflight exit code is the electron-runtime native gate.
