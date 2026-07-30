# Delights — the wildcard lens

Walked the snapshot (commit 9130779) as a first-run reader and as a five-year daily reader. Every item cites the code that makes it real. Effort tiers: XS (< half a day), S (a day), M (a few days). Ranked by delight-per-effort; the top item is the one I would defend to the reader's face.

All paths are relative to the snapshot root:
`/private/tmp/claude-501/-Users-jonnyroyal-dev-scripture-app/94f4876e-4122-4cc3-b070-0241f423837b/scratchpad/worktrees/ideation-snapshot`

---

## 1. The player forgets everything on quit — S

3,521 episodes, 41,426 playable moments, and not one byte of playback state survives a restart. There is no `localStorage` use in `src/renderer/components/PodcastPlayer.tsx`, and the settings schema in `src/electron/main.ts` (defaults block at ~line 537) persists `lastRead`, `recentPassages`, `researchSession`, `windowBounds` — but nothing for the player. Quit at minute 32 of a 50-minute Naked Bible episode and tomorrow the app has never heard of it. The app already honors this exact promise for reading (`lastRead`, workspace restore); the listening half of the product breaks it silently. Persist `{ showId, episodeId, positionSeconds, playing:false }` beside `lastRead` and offer it in the dock/transport as "Resume · 32:14". Not on the Build 2/3 lists (those cover surface, brand, transport family, margin loop) and not in the known-deferred set — it is unclaimed daily pain. This is the item I'd defend first: the reader listens while commuting/preparing, and every cold start currently costs a scrub-hunt through an hour of audio.

## 2. Window-title honesty — S

The title is frozen at `"Pericope"` in two places: `src/electron/main.ts:1741` (`title: "Pericope"`) and `src/renderer/index.html` (`<title>Pericope</title>`); nothing in the renderer ever sets `document.title`. Mission Control, the app switcher, and screen-share captions all lie by omission about what is open. Everything needed already exists: the active tab's register abbreviation machinery (`src/renderer/utils/studyWorkspace.ts` ~line 2064 — the fixed `1 THESS`-style abbreviation table) and named study groups. `document.title = "ACTS 19 · Sunday sermon — Pericope"` on workspace change is a one-effect fix. While in there, `win.setRepresentedFilename(libraryPath)` gives the macOS title bar its proxy icon — the library *is* a folder of plain files (the WelcomeScreen's whole promise), so let the window frame admit it.

## 3. First-run opens on a QA fixture — XS

A brand-new library opens to **Acts 19** because the default workspace is hardcoded to the D8 acceptance-test passage: `src/renderer/app.tsx:739-742` — `createStudyWorkspace(compatibilityPassageView({ book: "ACT", chapter: 19, packageId: "bsb" }), ...)`. STATUS.md confirms Acts 19 is the QA path ("the D8 Acts 19 precision/order/attention/draft path"). The riot at Ephesus is a strange first word for a scripture app to speak. One line makes the first-ever page intentional — John 1 ("In the beginning was the Word") or Psalm 1 ("Blessed is the man") is a statement of purpose. Cheapest symbolic win in this list.

## 4. A real application menu — and the ⌘W it quietly fixes — S/M

`grep -rn "Menu" src/electron/` returns nothing: the app ships Electron's **default** menu — "Electron" as the app-menu name in dev, Reload/Force Reload/Toggle Developer Tools under View, and crucially **File → Close Window bound to ⌘W**. Menu accelerators fire before the page sees the key, so the renderer's careful ⌘W handler (`src/renderer/app.tsx:1543`, close the active Study tab) and the promise printed in `src/renderer/components/ShortcutsOverlay.tsx:26` ("⌘W — Close the current Study tab") are contradicted by the frame itself on macOS. Build a small honest menu: Pericope (About, Settings ⌘,), File (New note, Close tab ⌘W routed to the renderer, Close window ⇧⌘W), View (Focus mode F, atmospheres, actual zoom), Go (Back Alt+←, Forward Alt+→, chapter arrows), Help (Keyboard shortcuts ?). A premium app whose menu bar says "Electron" is the single loudest provenance dishonesty a Mac user can see, and it costs a day.

## 5. Print / export a marked-up chapter — M

Zero `@media print` rules exist anywhere in the 21,019-line `src/renderer/styles.css` or `src/renderer/styles/*`. Yet everything a printed chapter needs is already on screen: washes (`HighlightUnderlay.tsx`), loom-bracket connections (`ConnectionUnderlay.tsx`), the paper page itself, and `LICENSES.md` explicitly records `export: true` permission flags for WEB and KJV. v1 is a print stylesheet: hide sidebar/topbar/margin chrome, keep the page and its washes, flow margin notes as endnotes with their references, footer line carrying the translation attribution string LICENSES.md already dictates ("World English Bible (WEB). Public Domain…"). v2 is File → Export PDF via `webContents.printToPDF`. A pastor who has marked Romans 8 all week wants to carry that page into the pulpit or hand it to an elder; today the only export is a screenshot. Highest ceiling of delight in this list; medium effort because the underlays are SVG and print faithfully already.

## 6. A keyboard map worthy of the keyboard — S

The shortcut system is genuinely deep, and the overlay undersells and under-reports it. `src/renderer/components/ShortcutsOverlay.tsx:9-33` is one flat 23-row list in which the same keys mean different things with no grouping — "1–5" appears at line 10 (switch views) and line 19 (choose a relationship) with nothing marking that these are different *places*. Worse, real shortcuts are missing entirely: Back/Forward Alt+←/→ (bound at `src/renderer/components/ScripturePage.tsx:2541` and advertised in a tooltip at line 4729), ⇧⌘M open a note on a selection, bare digits 1–5 wash / 0 erase, and ⇧↑/↓ extend by verse (all in the selection-modal keydown block in `src/renderer/components/MarkingSurface.tsx`, ~lines 1938-2010). The header already says "Keyboard model" — make it one: group rows by place (Reading · With words held · Study tabs · Window), render the Esc ladder it already footnotes, and complete the inventory. The overlay currently promises less than the app delivers, which is the rare honesty gap that runs in the flattering direction — still a gap.

## 7. An About page that names its witnesses — S

Settings → About (`src/renderer/components/SettingsPage.tsx:659-673`) is six `<dl>` rows with the version **hardcoded** as `<dd>0.1.0</dd>` — it will silently drift from `package.json` at the first bump (the plumbing to do it honestly exists: `app.getVersion()` is already exposed at `src/electron/main.ts:183-187`). Meanwhile `LICENSES.md` is a beautifully kept ledger — WEB/KJV/YLT/BSB with sources and permission flags, OpenBible CC-BY, TIPNR, Pleiades — and the podcast layer distinguishes publisher-granted from public-feed footings (`docs/trusted-resource-permissions.md`). None of it is visible in the app. For a product whose creed is provenance honesty, About is the natural altar: version from `app.getVersion()`, each translation with its one-line attribution, each dataset with its license, each show with its footing. Plus `app.setAboutPanelOptions({...})` so the native macOS About panel (which item 4's menu exposes) says the same thing.

## 8. Say it before the library lands on iCloud — M

STATUS.md's open gap D10 in the snapshot: "nothing stops a library from being opened or created on cloud-synced storage… The default path still resolves under `~/Documents`" — and indeed `getLibraryPath` (`src/electron/main.ts:1704`) defaults to `resolve(app.getPath("documents"), "ScriptureLibrary")`, which macOS Desktop & Documents sync silently uploads. The failure mode was lived, not hypothetical: `disk I/O error`, EINTR, a frozen splash. The WelcomeScreen (`src/renderer/components/WelcomeScreen.tsx:81-85`) proudly promises "Local by default · Nothing uploaded" while the recommended path may be neither. The kind fix is a sentence, not a wall: detect Documents-sync / an `.icloud` ancestor at confirm time and say "This folder is synced by iCloud. Pericope's library is safest on plain local disk — use ~/ScriptureLibrary instead?" (The working branch has already moved its own library to `~/ScriptureLibrary` per the incident; the shipping default and the warning are what a *new* reader needs.) Ranked here rather than #1 only because it is protection, not joy — but it is the item a five-year user would thank you for most bitterly.

## 9. A dock menu of recent passages — S

`recentPassages` is already persisted and normalized (`src/electron/main.ts` settings defaults; `src/renderer/utils/recentPassages.ts`; written from `src/renderer/components/ScripturePage.tsx:1739`), but `app.dock` is never touched in `src/electron/` (grep: zero hits). `app.dock.setMenu()` with the last five formatted recents (the `formatRecentLabel` helper already exists) plus "New note" gives the dock icon a memory: right-click Pericope on Sunday morning and jump straight to Thursday's chapter before the window even opens. Pure existing data, one small main-process function, very macOS-native quiet joy. (And deliberately **no** dock badge, ever — nothing in this app should count at the reader.)

## 10. Mouse thumb buttons for Back/Forward — XS

`navigateBack`/`navigateForward` exist with history stacks 50 deep (`src/renderer/components/ScripturePage.tsx:1976-1996`, `src/renderer/utils/navigationHistory.ts`), reachable via Alt+arrows and toolbar buttons — but a mouse's back/forward buttons (buttons 3/4) do nothing: no `mouseup`/`pointerup` button check in ScripturePage and no `app-command` / swipe wiring in `src/electron/main.ts` (grep: zero hits). Cross-reference chasing is exactly the workload where a browser-trained thumb reaches for that button. One small listener honoring the same guard the Alt+arrow path uses (`canvasShortcutBlocked`). Cheapest pure papercut in the list.

## 11. Plain ⌘C should keep the reference too — S

The marking tray's copy action enforces a lovely law: "Copy always includes the reference: a quotation without one is a sentence the reader cannot put back where they found it" (`src/renderer/components/MarkingSurface.tsx:2034-2041`, producing `“…” — John 13:34-35`). But the far more common gesture — drag a native selection, hit ⌘C — copies bare text with verse numbers and no reference, because nothing handles the document `copy` event. A pastor pasting into a sermon doc gets the good format only if he discovers the tray's More menu. Intercept `copy` on the reading canvas when the selection spans verse lines and emit the same curly-quoted, em-dashed format (plain text; leave rich text alone). The law already exists; extend its jurisdiction to the keyboard.

## 12. Atmosphere that follows the day — S/M

`nativeTheme.shouldUseDarkColors` is consulted exactly once — to pick the default at first launch (`src/electron/main.ts:538`) — then never again; there is no "follow system" option anywhere in `src/renderer/components/ThemePicker.tsx` or `theme.ts`. A reader in Paper at noon must hand-switch to Ink at night, every day, forever. The theme model is *already shaped for this*: `THEME_OPTIONS` carries `tone: "light" | "dark"` and `temperature: "warm" | "cool"` (`src/renderer/theme.ts:20-58`), so "Match system" is not a fifth theme but a pairing along the temperature axis the reader has already chosen (warm: Paper↔Ink; cool: Porcelain↔Onyx). Subscribe to `nativeTheme.on("updated")`, keep the material switch orthogonal exactly as the file's own comment argues it should be. Evening reading is the ritual this honors — the app dims when the study does.

## 13. Write the silence down — XS

There is not a single UI sound in the codebase — no `new Audio`, no `.play()` outside the podcast element (grep across `src/renderer`). That is correct, and it is currently an accident of omission rather than a law. One paragraph in `AGENTS.md`/design docs — "Pericope makes no sound it was not asked to make; the only audio is the audio the reader pressed play on" — costs nothing and protects the calm from a future well-meaning "gentle chime on save." Deliberate absence, stated, is a feature; unstated, it's a vacancy.

---

## What I checked and chose *not* to file

- **Session-restore grace**: already excellent — workspace snapshot persistence with debounce/flush/acknowledge (`src/renderer/utils/workspacePersistence.ts`, close-guard handshake in `main.ts` ~720-1898), crash recovery prompt on `render-process-gone`, cold-start background color matched to the canvas (`main.ts:1720` comment). Nothing to add.
- **First-run welcome**: `WelcomeScreen.tsx` is already the best first-run screen I've seen in this class — trust grid, honest path display, no dark patterns. Item 8 is its only flaw.
- **Command palette reference entry**: `parsePassage` + fell-through explanations + "state the drop, never rewrite the reader's reference" (`CommandPalette.tsx:320-370`) — already premium.
- **Tab cycling from the canvas**: intentional per standing decision; not re-flagged.
- **Karaoke/word-level sync, library-wide transcript search, MediaSession artwork, auto-expanding sheet**: known-deferred by decision; not proposed.
