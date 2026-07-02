# design-sync notes — scripture-app

## What this repo is
An **Electron scripture-reading app**, not a reusable component library. The
"components" are app screens in `src/renderer/components/` wired to a backend
via `window.api` (Electron contextBridge → SQLite). Synced as a design system
so claude.ai/design can compose on-brand screens.

## Build shape (package, explicit barrel entry)
- No published package entry, no per-component `dist/` `.d.ts` (`declaration:false`
  in `tsconfig.renderer.json`). We bundle an **explicit barrel**:
  `.design-sync/entry.tsx` (committed) re-exports exactly the design-surface
  components to `window.ScriptureApp`.
- **Why a barrel, not synth-from-src:** `main.tsx` runs `createRoot(...).render(<App/>)`
  at import; synth mode (`export * from` every `.tsx`) would pull that in and every
  preview page would hijack-render the whole App. The barrel controls exactly what
  ships. It also lets us include **`App`** (the shell / nav bar in
  `src/renderer/app.tsx`), which lives outside `cfg.srcDir` and synth would miss.
- Because the barrel is the `--entry`, discovery finds 0 PascalCase exports from the
  repo's real `.d.ts` (core/host) — so **the component list comes entirely from
  `cfg.componentSrcMap`** (all 8 pinned there). If you add a component, add it to
  BOTH `.design-sync/entry.tsx` (export) AND `componentSrcMap` (pin) AND
  `dtsPropsFor` (contract).
- Full command:
  `node .ds-sync/package-build.mjs --config design-sync.config.json --node-modules ./node_modules --entry ./.design-sync/entry.tsx --out ./ds-bundle`
- `App` is the full shell (sidebar nav Read/Write/Search/Notes/Import/Settings +
  active view). Its preview stubs the union of `window.api` calls the shell + the
  default ScripturePage view make on mount.

## Contracts (`cfg.dtsPropsFor`)
Synth mode can't extract the `Props` interfaces (named `Props`, and they reference
app domain types from `../api.js`). Every component's prop body is **hand-written**
in `cfg.dtsPropsFor` with inlined structural types. If a component's real props
change, update `dtsPropsFor` to match — it does NOT auto-track source.

## Excluded exports
`ToastProvider` and `ErrorBoundary` excluded from the component list via
`componentSrcMap: null` (context provider / error wrapper, not design surface).
They still ship on `window.ScriptureApp` (bundle exports everything), so previews
CAN import `ToastProvider` — ScripturePage's preview wraps in it (it calls
`useToast`).

## Previews need window.api stubs
Most screens call `window.api.*` in effects/handlers. Authored previews set a
module-top `window.api` stub with realistic data before render. Components that
need it: ScripturePage (scripture.getChapterText / library.queryRange /
scripture.getCrossRefsForChapter / ai.semanticMargin), SettingsPage &
BudgetSettings (ai.getBudgetEnvelope / getJobs), SearchView showAll cell
(library.readAllNotes). LivingMargin / ImportPage / WritingSheet render from
props alone (no render-time api). This is preview SETUP, not reimplementation —
the real exported component renders.

## Fonts (accepted substitutes — non-blocking)
`design-tokens.json` declares brand fonts **Source Serif 4** (reading) and
**Inter** (UI), plus mono fallbacks (JetBrains Mono / Fira Code / Consolas).
`styles.css` has NO `@font-face` and NO `@import` — the app relies on system
availability. They are declared in `cfg.runtimeFontPrefixes` to suppress
`[FONT_MISSING]`. **Consequence:** designs render with serif/sans/mono system
fallbacks (Georgia / system-ui / monospace), not the exact brand webfonts. The
look holds (serif reading text, sans UI) but is not pixel-exact.

## Re-sync risks (watch-list for the next run)
- **`cfg.dtsPropsFor` is hand-maintained.** If `src/renderer/components/*.tsx`
  Props change, the emitted `.d.ts` silently goes stale — re-read the interfaces
  and update. Same for the domain types inlined into those prop bodies.
- **Preview mock data is inlined** in `.design-sync/previews/*.tsx` and can drift
  from the real `window.api` return shapes (`src/renderer/api.ts` interfaces). If
  api types change, a preview may render wrong or throw — re-check against
  `api.ts` (QueryResult, ChapterData, BudgetEnvelopeData, AIJobData, etc.).
- **Brand webfonts still not shipped** (see Fonts). To upgrade fidelity later:
  add a Google Fonts `@import` for Source Serif 4 + Inter (would show as
  `[FONT_REMOTE]`, loads at runtime) — requires a small css hook, out of scope
  for this run.
- **Synth-entry means weaker types** than a real build. If the app ever ships a
  component `dist/` with `.d.ts`, switch to a real `--entry` and drop most of
  `dtsPropsFor`.
- Playwright browser cache is at the macOS default `~/Library/Caches/ms-playwright`
  (build 1228 ↔ playwright 1.61). Do NOT set `PLAYWRIGHT_BROWSERS_PATH=~/.cache/...`
  when validating — that path is empty and validate falls back to `[RENDER_SKIPPED]`.
