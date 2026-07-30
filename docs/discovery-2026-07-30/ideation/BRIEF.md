# Pericope — one ranked brief

Four scouts walked the snapshot (commit 9130779) through four lenses: new features, unfinished features, cleanup, and delights. This is the merged, deduplicated, ranked result. Ranking is value-per-effort across all four lenses at once. Every claim keeps its file citation.

Two big merges up front: the iCloud default-path finding appeared in both the unfinished and delights reports (kept here as one item, the strongest framing of each half); the print/handout idea appeared in both the feature and delights reports (kept as one item). The `collapsed` workspace field appeared as "leave for now" in one report and as a fully-planned safe deletion in another — the deletion plan wins because it needs no version bump and old files still round-trip.

---

## The top ten

### 1. Fix the iCloud default library path (two lines, then a sentence)
The disk-I/O freeze that forced the library move to `~/ScriptureLibrary` was diagnosed and escaped — but the *default* path still points at the trap. `src/electron/main.ts:1704` and `src/cli/index.ts:39` both fall back to `Documents/ScriptureLibrary`, which macOS Desktop & Documents sync silently uploads; any fresh init (new machine, cleared store, CLI `library init`) recreates the exact lived failure. Meanwhile `src/renderer/components/WelcomeScreen.tsx:81-85` promises "Local by default · Nothing uploaded." Fix: change both fallbacks to `resolve(homedir(), "ScriptureLibrary")`, then add one kind sentence at the Welcome confirm step when the chosen folder is cloud-synced. Smallest item in this brief; highest regret-per-line if left.

### 2. Open the first-ever page on purpose (one line)
A brand-new library opens on Acts 19 — the riot at Ephesus — because the default workspace is hardcoded to the D8 acceptance-test passage (`src/renderer/app.tsx:739-742`; STATUS.md confirms Acts 19 is the QA path). One line makes the app's first word intentional: John 1 ("In the beginning was the Word") or Psalm 1. The cheapest symbolic win found anywhere in the survey.

### 3. Let the player remember where it stopped (a day)
3,521 episodes and 41,426 playable moments, and not one byte of playback state survives a restart — no persistence in `src/renderer/components/PodcastPlayer.tsx`, and the settings schema (`src/electron/main.ts` ~line 537) saves `lastRead`, `recentPassages`, and `windowBounds` but nothing for listening. Quit at minute 32 of a 50-minute episode and tomorrow the app has never heard of it — yet it keeps this exact promise for reading. Persist `{showId, episodeId, positionSeconds}` beside `lastRead` and offer "Resume · 32:14" in the dock. Unclaimed by the in-flight player builds; daily pain, one day of work.

### 4. Bury the collapse field and sweep the dead CSS behind it (one afternoon)
The tab strip stopped reading `collapsed` on 2026-07-30, but the corpse is fully persisted: the field, `toggleStudyWorkspaceGroup` (`src/renderer/utils/studyWorkspace.ts:632-668`), `visibleStudyWorkspaceTabIds` (`:1912-1930`), a validator that rejects whole groups without the field (`src/electron/study-workspace-settings.ts:454`), and 25 in-code eulogies. The cleanup scout mapped a safe one-commit order (reader tolerance first, no version bump, old workspaces still load) and verified ~900 lines of dead CSS from the same era — `lang-tree-*` (`styles.css:12278`), the retired marking-dock family (`:17946-18534`), old margin chrome — using a two-grep protocol that respects the app's dynamically-built class names. Net: roughly −1,000 lines and one field of phantom state, zero visible change, which is the point.

### 5. Hear this chapter taught — a listening queue (a weekend)
One control: "Listen through this chapter" — a queue of the chapter's timed moments, longest treatments first, each launching at its timestamp and advancing when the span ends. Romans 8 becomes a 40-minute guided walk while the page stays open. Nearly everything exists: `momentsFor` already returns moments banded and sorted longest-first (`src/core/passage-index.ts:211-243`), all moments have validated playable audio, and `playPodcastEpisode` launches at any second (`PodcastPlayer.tsx:165-188`). New code is a queue array and an advance timer. Guardrail: the queue is the chapter's own moments in a declared order — never autoplay radio, never an algorithmic "up next."

### 6. Make the window frame honest — title, menu, ⌘W (a day or two)
Two related dishonesties in the macOS frame. The title is frozen at "Pericope" (`src/electron/main.ts:1741`, `index.html`) though the abbreviation machinery for "ACTS 19 · Sunday sermon" already exists (`studyWorkspace.ts` ~2064) — one effect fixes it. Worse, the app ships Electron's *default* menu (no `Menu` reference anywhere in `src/electron/`), so the menu bar says "Electron" in dev and File → Close Window steals ⌘W before the renderer's careful close-the-study-tab handler (`app.tsx:1543`) ever sees it — contradicting the promise printed in `ShortcutsOverlay.tsx:26`. A small honest menu (About, Settings ⌘,, ⌘W routed to the renderer, Go Back/Forward, Help) fixes both the loudest provenance lie a Mac user can see and a real keyboard bug.

### 7. One honesty commit: delete the machinery that pretends (a day)
Three verified-dead subsystems mislead anyone reading the code — and one misleads the user. The command palette's "Ask Intelligence" row opens the Settings page (`CommandPalette.tsx:1063-1071`); its back half — `ai-invoke`, `get-ai-status`, `enqueue-ai-job` (`main.ts:3914-3944`) — is never exposed in preload and contains placeholder prompts. Delete the handlers and make the palette row honest; build a real answer surface only when it can meet margin quality. The plugin scaffold (~510 lines: `src/core/plugins/`, `src/host/plugin-runtime.ts`, `plugin-broker.ts`) has zero imports and zero plugins — the trusted-resource system is the app's actual answer to outside material; delete it. And the bridge carries six preload methods plus three IPC handlers with no callers (verified caller-by-caller: `insertClaim`, `getFacts`, `getEnrichment`, `embedNotes`, `get-margin`, `get-all-notes`, `get-note`), plus ~20 misc dead exports including a minimap builder the tests *assert must not run* (`tests/place-research.test.ts:148-152`). One commit, ~1,000 lines, and every method in `window.api` means "the app does this" again.

### 8. Surface the UBS flora, fauna, and realia the reader already paid for (a few days)
The strongest unfinished-feature finding: two complete licensed datasets — 19 MB of biblical plants, animals, artifacts, routes, and parallel passages (`data/scripture/ubs/`) — with parsers (`src/core/entities/ubs-flora-fauna.ts`, 580 lines; `ubs-routes-parallels.ts`, 961 lines), importers, tests, and *curated attribution strings* already written — and not one byte ever reaches a reader. No host loader, no IPC channel, no margin section; grep confirms zero imports outside the import scripts and tests. The finish is a loader modeled exactly on `src/host/place-research-loader.ts`, one read-only channel, and a section in the entity research pane; the anchors file (`ubs-flora-fauna-anchors.json`) makes reference plumbing a lookup. Evidence-grade, attributed, and entirely in the app's taste. Flora/fauna/realia first; parallel passages second; routes can wait.

### 9. The fair copy — print a marked-up chapter (a week)
Merged from two lenses: a pastor who marked Romans 8 all week wants to carry that page into the pulpit, and today the only export is a screenshot. Zero `@media print` rules exist in 21,019 lines of CSS, yet everything a printed page needs is on screen: washes (`HighlightUnderlay.tsx`), loom-bracket connections as SVG (`ConnectionUnderlay.tsx`, `connectionGeometry.ts`), exact character coverage via alignment fragments, and `LICENSES.md` already records `export: true` for WEB and KJV with the required attribution strings. Version 1 is a print stylesheet — hide chrome, keep page and washes, notes as endnotes, attribution footer. Version 2 is File → Export PDF via Electron's `printToPDF`. No templates, no options panel — one paper grammar. The only item in this brief that lands in a pew.

### 10. Pull the threads — start a study from a passage (a week)
The sermon-prep centerpiece and the payoff of the just-landed study line: from a pinned selection, one gesture creates a named study group whose tabs are the passage, its strongest cross-references (29,364 vote-weighted rows, `cross-reference-loader.ts`), and the people and places it names. Pure orchestration of existing calls — `openEntityWorkspaceTab` (`studyWorkspace.ts:1515`), `createStudyWorkspaceGroup` (`:454`), `openPassageWorkspaceTab` (`:1816`), the naming popover (`app.tsx:969-977`). Guardrails: cap the seed at ~4 tabs, show what will open before it opens, never an AI outline generator.

---

## The rest, ranked

| # | Item | Lens | Effort | Citation |
|---|---|---|---|---|
| 11 | Plain ⌘C on the canvas keeps the reference, matching the tray's own copy law | Delight | S | `MarkingSurface.tsx:2034-2041` |
| 12 | The collation — one verse across KJV/WEB/YLT with shared-occurrence cross-lighting; first reader-facing return on the alignment spine | Feature | week | `occurrence-alignment-store.ts`, packages in `data/scripture/packages/` |
| 13 | Dock menu of the five recent passages (no badge, ever) | Delight | S | `recentPassages.ts`; `app.dock` untouched in `src/electron/` |
| 14 | Mouse back/forward thumb buttons drive the existing history stacks | Delight | XS | `ScripturePage.tsx:1976-1996`, `navigationHistory.ts` |
| 15 | Search my own margin — a palette scope over notes, wash quotes, connection labels; `search-notes` IPC is already live | Feature | weekend | `main.ts:2592`, `note-search-query.ts` |
| 16 | The ledger of a passage — "you have been here," three lines from git-recorded revisions | Feature | weekend | `git-revision-store.ts`, `snapshot-revision-store.ts` |
| 17 | Loom anchoring (lab/TODO §1): translation-durable marks on the now-shipped alignment packages; geometry stays with the in-flight revival | Unfinished | week | `HANDOFF-smart-shapes.md`, `occurrence-alignment.ts` |
| 18 | "Match system" theme along the temperature axis already in the model | Delight | S/M | `theme.ts:20-58`; `nativeTheme` read once at `main.ts:538` |
| 19 | Regroup and complete the shortcuts overlay — missing bindings verified in code | Delight | S | `ShortcutsOverlay.tsx:9-33`, `MarkingSurface.tsx` ~1938-2010 |
| 20 | About page that names its witnesses — live version + the LICENSES.md ledger, in-app | Delight | S | `SettingsPage.tsx:659-673` (version hardcoded "0.1.0") |
| 21 | By heart — verse memorization as a seal state via alignment char ranges; no streaks, no decks | Feature | week | `occurrence-alignment.ts`, `MarkingSurface.tsx` |
| 22 | Tomorrow's page — resume position plus exactly one next-chapter listening offer | Feature | weekend | `recentPassages.ts`, `passage-index.ts` |
| 23 | Delete 41 dead CSS custom properties; file the phantom consumers (`--focus-ring`, `--color-error`…) as follow-up | Cleanup | XS | `styles.css:51-55, 214-216, 453ff` |
| 24 | Fix the five comments that lie ("No spinners — anywhere," beside four live spinners) and collapse three identical spin keyframes into one | Cleanup | XS | `styles.css:14331`, `MarkingSurface.tsx:306` |
| 25 | Delete 3.4 MB of orphaned glass-theme textures (keep `brand/pending/` — likely Build 2 staging) | Cleanup | XS | `src/renderer/assets/glass-{dark,light}.png` |
| 26 | The locator — hairline-coastline ink map for place entities; never a slippy map | Feature | week | `data/scripture/places/`, `natural-earth-50m-land.geojson` |
| 27 | The word's trail — concordance at gesture speed off `akjv-strongs`; screen the Strong's data first per standing memory | Feature | week | `reverse-index-loader.ts` |
| 28 | Move stale root docs to `docs/history/`; decide once whether `docs/ui-audit/` (97 MB, regrowing every QA run) keeps goldens only | Cleanup | S | `CURRENT_STATE.md`, `docs/ui-audit/` |
| 29 | Write the silence down — one paragraph making "no UI sounds" a stated law instead of an accident | Delight | XS | no `new Audio` anywhere in `src/renderer` |

Noted but deliberately not ranked: the dock chapter list, `idle` player status, and `taught-here-*` CSS are owned by player Builds 2/3; Tab-cycling and word-timing karaoke are settled by standing decision.

---

## Three next moves, one agent each

**Build — the chapter listening queue (#5).** A weekend of orchestration over the app's largest asset: queue array, advance timer, one control on the chapter. Everything else (`momentsFor`, `playPodcastEpisode`, MediaSession) already exists. Fold in the player-resume persistence (#3) if the agent has room — same surface, same settings block.

**Cleanup — the collapse-field burial commit (#4).** The cleanup scout's plan is agent-ready: persistence reader made tolerant first (`study-workspace-settings.ts:454`), then model, then tests (flip the keep-assertion at `tests/study-line-contract.test.ts:342`), then the eulogy comments, with the dead `marking-dock-*` and `lang-tree-*` CSS riding along under the two-grep protocol. Verify with `npm run typecheck && npm test` plus the three QA tours, and confirm an old workspace file with `collapsed: true` still loads. Prepend the two-line iCloud path fix (#1) to the same session — it should not wait for anything.

**Delight — the honest frame (#6).** One agent builds the application menu, routes ⌘W to the renderer's close-tab handler, sets `document.title` from the active study, and adds `setRepresentedFilename(libraryPath)`. Include the one-line first-run passage change (#2) — thirty seconds of work that changes the first thing every future reader ever sees.
