# design-sync notes — scripture-app (Pericope)

## What this repo is
An **Electron scripture-reading app**, not a reusable component library. The
"components" are app screens in `src/renderer/components/` wired to a backend
via `window.api` (Electron contextBridge → SQLite). Synced as a design system
so claude.ai/design can compose on-brand screens.

## Which project this syncs to
**`Pericope Living Margin`** — `56832d1c-3687-4cf4-b8c7-63529ec7132e`, created
2026-07-26 for the Living Margin / word-card redesign. It is the pin in
`config.json`.

The earlier project **`Scripture App Design System`**
(`9451b47c-9b1e-4f57-b355-f37f2eccb58b`) was the previous sync's target and is
NOT the pin any more. It still exists; nothing here writes to it. Do not
"restore" it as the pin — the redirect was the owner's explicit choice.

Config also **moved this run**: `design-sync.config.json` (repo root, the old
name/location) → `.design-sync/config.json`.

## Build shape (package, explicit barrel entry)
- No published package entry, no per-component `dist/` `.d.ts`
  (`declaration:false` in `tsconfig.renderer.json`). We bundle an **explicit
  barrel**: `.design-sync/entry.tsx` (committed) re-exports exactly the
  design-surface components to `window.ScriptureApp`.
- **Why a barrel, not synth-from-src:** `main.tsx` runs
  `createRoot(...).render(<App/>)` at import; synth mode would pull that in and
  every preview page would hijack-render the whole App. The barrel also lets us
  include **`App`** (`src/renderer/app.tsx`), which lives outside `cfg.srcDir`.
- Because the barrel is the `--entry`, discovery finds 0 PascalCase exports from
  the repo's real `.d.ts` — so **the component list comes entirely from
  `cfg.componentSrcMap`**. Adding a component means editing THREE places:
  `.design-sync/entry.tsx` (export) AND `componentSrcMap` (pin) AND
  `dtsPropsFor` (contract).
- Full command (note `--config` path changed this run):
  ```
  node .design-sync/flatten-css.mjs   # ← REQUIRED FIRST, see CSS below
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules ./node_modules --entry ./.design-sync/entry.tsx --out ./ds-bundle
  node .ds-sync/package-validate.mjs ./ds-bundle
  ```

## Components synced (11)
`App`, `ScripturePage`, `LivingMargin`, `SearchView`, `SettingsPage`,
`WritingSheet`, `ImportPage`, and — added 2026-07-26 for the margin brief —
`LanguageWordsSection` (the word card), `RenderingOrbitView`,
`SourcesDisclosure`, `ConnectionCard`.

- **The orbit export is `RenderingOrbitView`, not `RenderingOrbit`.** The file
  also exports `SenseOutlineView` and the model builders `forwardOrbitModel` /
  `reverseOrbitModel` / `senseOutlineModel`. Guessing the name breaks the build.
- **`BudgetSettings` was deleted from the app** in `3f8ec71` ("Refine settings
  onboarding and import") and removed from the barrel, config and previews on
  2026-07-26. Its stale barrel export failed the build with
  `[UNRESOLVED_IMPORT]`. **Lesson: a deleted component does not announce itself
  — the barrel goes stale silently and only the build catches it.**

## CSS: the entry stylesheet MUST be flattened first
`src/renderer/styles.css` is a closure — it `@import`s `./fonts.css` and eight
files under `./styles/`. The converter inlines the entry stylesheet into
`_ds_bundle.css` **verbatim, @import lines included**, but does not copy the
imported siblings → nine `[CSS_IMPORT_MISSING]` errors, and rendered designs
would receive component CSS with eight of its nine parts missing.

`cfg.tokensGlob` **cannot** fix this: `copyTokens` only reads from a
`node_modules` package and emits into `tokens/`, while these imports must
resolve relative to the stylesheet itself.

Fix: **`.design-sync/flatten-css.mjs`** (committed) inlines them in place,
preserving order — CSS cascade is positional — and writes
`.design-sync/.cache/styles.flat.css`, which `cfg.cssEntry` points at. It
throws if it ever inlines zero imports, so it cannot silently degrade into a
copy. **Re-run it before every build**; the output is gitignored, the script is
durable.

## `cfg.provider` = `ToastProvider`
Four components call `useToast` and threw `useToast must be used within
ToastProvider` (SearchView, SettingsPage, WritingSheet, SourcesDisclosure).
Set once at config level rather than wrapped per preview. **Do not add a manual
ToastProvider wrapper inside a preview** — it is applied automatically.

## Contracts (`cfg.dtsPropsFor`) — hand-written, and they DO rot
Synth mode can't extract the `Props` interfaces (they're named `Props` and
reference app domain types), so every prop body is hand-written with inlined
structural types.

**This bit them in 2026-07-26:** `LivingMargin` had drifted from ~10 props to
~30 (`packageId`, `sessionOwnerTabId`, `chapterVerseText`, `pinnedRange` …) and
`crossRefs` had changed from `string[]` to `CrossReferenceResultData | null`.
The config still described the old shape, so the emitted `.d.ts` — **the exact
thing the design agent codes against** — was wrong, and the preview crashed.
Re-read the real interfaces whenever a preview starts failing with
`Cannot read properties of undefined`.

## Previews need `window.api` stubs
Most screens call `window.api.*` in effects/handlers. Authored previews set a
module-top `window.api` stub with realistic data before render. Check stub
shapes against the REAL interfaces in `src/renderer/api.ts` — a stub with the
wrong shape renders a broken card that still looks authored.

## Real data for previews
`.design-sync/.cache/real-data.json` (generated, gitignored) holds values pulled
from the SHIPPED datasets so previews use real content: `G749` ἀρχιερεύς
(Mounce "a high-priest, chief-priest", frequency 122), the `G4245G` "elder:
Elder" / `G4245H` "elder: old" sense split, TIPNR Aaron / Bethlehem / Ananias,
and the fact that **19 distinct people are named Azariah**. The owner asked
explicitly for real data in examples — do not regress to placeholder content.

## Guidelines shipped to the design agent
`cfg.guidelinesGlob` → `.design-sync/guidelines/*.md`, currently
`01-data-shape-old-vs-new.md` (what data the margin can draw now vs before) and
`02-the-brief-word-card-and-entity-card.md` (the brief, plus the redundancy and
overload rules). `cfg.readmeHeader` → `.design-sync/conventions.md`. All three
are committed and human-editable; keep them true rather than rewriting them.

## Fonts (accepted substitutes — non-blocking)
`design-tokens.json` declares **Source Serif 4** (reading) and **Inter** (UI);
`styles.css` has no `@font-face` and no webfont `@import`, so the app relies on
system availability. Declared in `cfg.runtimeFontPrefixes` to suppress
`[FONT_MISSING]`. **Consequence:** designs render with system fallbacks
(Georgia / system-ui / monospace), not the exact brand faces. The look holds but
is not pixel-exact. Owner-accepted.

## Atmosphere classes — the ids, the labels and the CSS all disagree
Verified against the built `_ds_bundle.css` on 2026-07-26 (only 8 selectors in
the whole sheet set `--bg-reading`):

| appearance | `AppTheme` id | shell classes | where its tokens live |
|---|---|---|---|
| Paper | `light` | `app-shell` | `:root` (default — no theme class) |
| Ink | `dark` | `app-shell dark` | `.dark` — **`.theme-dark` does not exist** |
| Porcelain | `porcelain` | `app-shell theme-porcelain` | `.theme-porcelain` |
| Onyx | `onyx` | `app-shell theme-onyx dark` | `.theme-onyx` **and** `.dark` |

`app.tsx` emits `theme-${theme}` for all four, but only the porcelain and onyx
classes carry rules. **A dark surface styled with `theme-dark` alone silently
renders as Paper** — the `dark` class is what makes a dark atmosphere dark.
`.theme-paper` and `.theme-slate` DO exist in the sheet but set no core tokens;
they are not the shell's atmosphere classes and must not be used as such.
`conventions.md` carries this table because the design agent would otherwise
guess `theme-light`/`theme-dark` and be wrong in a way nothing downstream
catches.

## Config gotcha
Top-level config keys are validated **strictly**. `previousProjectId` was
rejected outright (`✗ config: unknown key`) — anything that isn't a schema key
belongs in this file, not the config.

## Playwright
Browser cache is the macOS default `~/Library/Caches/ms-playwright`;
**chromium build 1228 ↔ playwright 1.61**, confirmed again this run
(`playwright-core/browsers.json` pins 1228). Do NOT set
`PLAYWRIGHT_BROWSERS_PATH=~/.cache/...` — that path is empty and validate falls
back to `[RENDER_SKIPPED]`.

## Preview harness facts (learned 2026-07-26, worth reusing)
- The card wraps previews in `ToastProvider` (via `cfg.provider`) but **not** in
  `.app-shell.theme-porcelain` — the page body is plain `#fff`. A preview that
  wants the app's atmosphere must supply that wrapper itself.
- `.app-shell` is `display:flex; height:100vh; overflow:hidden`, so a preview
  using it needs `display:block; height:auto` overriding or the card collapses.
- Previews mount with `createRoot`, so `useEffect` runs — which is how
  `SourcesDisclosure`'s `<details>` gets opened for the screenshot.
- **Anything a preview imports must be exported from `entry.tsx`.** Story
  imports are shimmed from `'scripture-app'` to `window.ScriptureApp`, so a name
  that is not on the global resolves to `undefined` **silently** — no compile
  error, a runtime death inside the story. This bit the orbit model builders:
  the barrel comment claimed they shipped while the export list omitted them.
- `cfg.overrides.<Name>.viewport` is the fix when a card is taller than the
  900x700 photograph — `LanguageWordsSection` needs `900x1120` because Acts 24:1
  is a 22-token verse and the panel runs ~1,050px. Do not solve it with a CSS
  `transform: scale()` in the preview; that ships a shrunken photograph.

## Real orbit data (measured with the app's own builders — do not invent these)
- **ἀρχιερεύς** G749: 122 uses, but only **three** MACULA bands (Chief Priests
  64 / High Priest 57 / High Priesthood 1). It therefore **cannot** illustrate a
  remainder tail — a story needing "N more renderings" must use another word.
- **καταργέω** — 27 uses over 9 bands, and **חֵסֵד** H2617 — 237 over 9 bands:
  both produce the literal "6 more renderings" phrasing from C·4 §3·6.
- Reverse orbit for English "love" from the BSB reverse index: 160 over 5 bands
  → "2 more words behind it".

## Card modes (applied 2026-07-26 from `[GRID_OVERFLOW]`)
`App`, `ConnectionCard`, `LanguageWordsSection`, `LivingMargin`, `SearchView`,
`WritingSheet` → `cardMode: "column"` (one story per row, full card width).
`ScripturePage` → `cardMode: "single"` with `primaryStory: "ReadingWithMargin"`,
because its stories position content outside the cell (fixed/portal) and no grid
layout can present that.

## Product defects the previews surfaced (app bugs, not preview bugs)
- **`isContentish` never filters** (`src/renderer/components/LanguageWordsSection.tsx:128`).
  Its fallback `t.lemma && t.strong && t.strong !== "3588"` matches every function
  word in a real MACULA package, so the intended "long verse shows content words
  first" strip never engages — 19 of 22 tokens qualify at Acts 24:1 and "All 22"
  offers only three more articles. This is the main reason the word panel does
  not fit a screen.
- `.lang-usage` strands its `·` separators on their own lines at 340px.
- The word-card section header — which owns the "Follow reading" control — is not
  sticky, so it scrolls away on a long verse.

## Known render warns (triaged, expected — not new)
- `[TOKENS_MISSING]` for `--bg-input`, `--color-error`, `--mark-session-top`,
  `--mark-session-left`, `--mark-session-width`, `--fw-bold` — the mark-session
  ones are set at runtime via inline style, which is expected to be absent from
  static CSS.
- `[GRID_OVERFLOW]` on `SearchView` (`AllNotes`, `SearchBox` render wider than a
  grid cell) — remedy is `cfg.overrides.SearchView: {"cardMode": "column"}`.
- `[RENDER_THIN]` on `SearchView` (variants render identically).

## Re-sync risks (watch-list for the next run)
- **The barrel and `componentSrcMap` do not track the source.** A component
  deleted or renamed upstream fails the build; a component ADDED upstream is
  silently missing. Diff `src/renderer/components/*.tsx` against
  `componentSrcMap` at the start of every sync.
- **`cfg.dtsPropsFor` is hand-maintained and demonstrably rots** (see Contracts).
  It is the design agent's API contract, so a stale entry is worse than a stale
  preview.
- **Preview mock data is inlined** and drifts from the real `window.api` return
  shapes in `src/renderer/api.ts`.
- **`flatten-css.mjs` must be re-run** whenever `src/renderer/styles.css` or any
  file it imports changes, and whenever a NEW `@import` is added to that closure.
- **Brand webfonts still not shipped** (see Fonts).
- The app's data layer grew ~140 MB of new lexical/entity sources on 2026-07-26;
  `guidelines/01-data-shape-old-vs-new.md` describes it and will need updating as
  those sources actually reach the UI.
