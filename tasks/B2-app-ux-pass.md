# B2 — App UX Pass

> **Status:** Complete for the desktop B2 scope. Target achieved: L3.
> **Predecessors:** A0 (snapshot), A1 (native build), B1 (scripture data).
> **Contracts:** §4.2 (event fold), §4.4 (SQLite materialized view), §4.6 (note format), INV-7 (append-only), INV-9 (safe to rebuild).

## Progress — 2026-07-15 (Reading lens and translation continuity)

The reader and Command K now share one spatial keyboard model, and changing Bible text no longer discards reading context:

- **Living Margin lenses from the text:** while the reading canvas owns focus, Tab and Right move through `Overview → Refs → Passage → Notes`, Shift-Tab and Left reverse, and the sequence wraps. The active panel really changes while focus remains on the verse; Up/Down remain reserved for verse movement.
- **Command K uses the same model:** Tab/Shift-Tab and Left/Right switch its four active lenses while focus stays in the query. Up/Down, Home/End, and Enter continue to operate on results.
- **Translation-free selection persists:** whole-verse selection and its stable range anchor survive BSB/WEB changes because their coordinates are canonical. Translation-specific phrase offsets, transient toolbars, and highlight animations are cleared.
- **The reading spot survives reflow:** before a package switch, the reader captures the verse nearest the 32% eye-line and its visual offset. After the new text renders, that verse is restored to the same position; chapter/book navigation still deliberately starts at the top.
- **Selected prose never blinks out:** the Living Margin retains the last complete selected quotation during the package handoff, then atomically replaces it with the new translation. That fallback is display-only; package-scoped passage analysis waits for the real new text instead of caching the transient empty frame as “no insight.”
- **Repeatable proof:** Command K QA covers Tab and arrow lens changes with query focus retained. Living Margin QA covers the complete reading-canvas keyboard loop plus an Acts 19:1–7 BSB→WEB→BSB switch that retains all seven selected verses, the Passage lens, a nonzero scroll position, and the exact verse offset. A mutation observer proves the selected quotation remains nonempty for the entire switch and changes to the target translation.

**Verification:** full `npm test` (**421 tests: 411 passing, 10 expected Electron-ABI skips**), `npm run lint`, renderer build, focused keyboard/continuity contracts, `npm run qa:command -- --no-screenshots`, `npm run qa:margin -- --no-screenshots`, and `git diff --check` pass. Mobile remains outside this worktree.

## Progress — 2026-07-15 (Local Command K intelligence)

The desktop reader now has one keyboard-first entry point for the four searches pastors are most likely to repeat, without mixing public corpus data with the user's library or pretending lexical retrieval is semantic:

- **Four deliberate lenses:** `Intelligence | Scripture | Notes | Names` share one quiet palette. Intelligence blends only the strongest relevant result types and exact command intents; Scripture, Notes, and Names remain complete, separately labelled indexes. Empty Intelligence shows recent reading rather than adding a fifth Recents tab.
- **Natural Scripture lookup:** exact references and same-chapter ranges navigate atomically, while ordinary questions and phrases search the active bundled translation with exact-phrase, meaningful-term, ordered-proximity, and light English-inflection ranking. Canonical order is the stable tie-break; current reading context only breaks otherwise-equal results.
- **Name-first people and places:** all 4,260 shipped STEPBible TIPNR entities are searchable. Exact, prefix, and close-name matches outrank definition-only matches, while role terms such as `apostle` intentionally return multiple people. Opening an entity moves to its nearest relevant occurrence in the current book or chapter when possible.
- **Local notes stay local:** plain queries are escaped into safe FTS5 expressions before host execution, so Scripture-shaped input such as `John 3:16` cannot be parsed as FTS syntax. A chosen result opens the existing full note detail rather than a truncated palette preview.
- **Actions without a junk drawer:** New note, Study visibility, focus mode, Notes, Search, and Settings are inferred in Intelligence from exact titles and keywords. They outrank incidental Scripture text matches without taking a permanent fifth tab.
- **Complete desktop keyboard path:** global Command/Ctrl-K opens the palette; Tab and Right activate `Intelligence → Scripture → Notes → Names` in a continuous loop while the typing cursor stays in the query, with Shift-Tab and Left reversing the loop. Up/Down plus Home/End own result navigation; Enter activates; Escape closes and restores the invoker. Every lens change replaces the selected state and result panel rather than merely moving a hover/focus treatment.
- **One restrained material:** the palette uses one border, one input, one hairline tab row, flat result rows, a neutral selected wash, and a short gold focus rail across Paper, Ink, Glass, and Candlelight. It remains overflow-safe at the 900px desktop floor and does not add mobile behavior in this worktree.
- **Truthful semantic boundary:** this pass does not label lexical Scripture matching as semantic. A future semantic artifact should embed one coordinate-level reference corpus, preferably contextual passage chunks keyed by translation-free `bref`, then render hits in the active translation. Embedding five near-duplicate full Bibles would cost roughly 475 MB at the current 768-dimensional Float32 model; one quantized 31,102-coordinate artifact is the appropriate B3/B4 follow-on.
- **Repeatable proof:** `npm run qa:command` covers exact reference and range navigation, phrase search, role-based TIPNR search, direct note opening, command intent, the full keyboard path, all four atmospheres, and horizontal-overflow checks. The first uncached active-translation search completes in about 366 ms including the 120 ms debounce; later searches reuse the local corpus cache.

**Verification:** full `npm test` (**420 tests: 410 passing, 10 expected Electron-ABI skips**), `npm run lint`, renderer typecheck, Electron build, renderer build, focused Command K contracts, `npm run qa:command`, refreshed `npm run qa:topbar`, four-atmosphere screenshot inspection, and `git diff --check` pass. Mobile, source-shelf search, and the future semantic Scripture artifact remain outside this bounded pass.

## Progress — 2026-07-15 (Intentional Living Margin views)

The right rail now separates automatic passage context from the user's chosen study lens, then leads with a small, source-grounded intent view instead of forcing the reader to hunt across unrelated panels:

- **Scope and lens are orthogonal:** the persistent `Chapter | In view | Selected` state still follows the reading context, while `Overview | Refs | Passage | Notes` remains the reader's stable view choice across verse and scope changes. Overview is leftmost and opens by default; a deliberate reader choice still persists afterward.
- **A selective intent Overview:** the first view shows at most two ranked OpenBible references, the strongest anchored or retrieved note evidence, and up to four people/place records explicitly indexed in the current range. It shows nothing when the evidence is weak, never invents quotation/prophecy/theme labels, and keeps OpenBible and STEPBible TIPNR attribution visible.
- **Three complete deep dives:** Refs owns the full returned OpenBible result set and separate note-derived links, without a collapsed remainder or clipped verse text. Passage owns chapter context, original-language study, word detail, and highlight tools. Notes owns passage capture, anchored notes, insight, themes, claims, and complete expandable note bodies without one generic `More` gate.
- **Context never disappears:** reference and bounded quotation remain above the tabs, so every view answers what it is about before presenting its own material. Each view has a tailored empty state rather than borrowing another view's controls.
- **Quiet, durable navigation:** one hairline tab row and a short centered gold current mark replace stacked mixed-purpose sections. Tab selection persists, each view restores its own scroll position, and a scope change resets stale scroll without changing the chosen lens.
- **Purposeful inner hierarchy:** Overview uses only `Scripture`, `Your library`, and `People & places`; Refs begins directly with the attributed OpenBible source instead of repeating a generic Connections heading. Passage names its highlight action and current state. Notes uses `In this chapter`, `At this verse`, or `For this passage` rather than echoing the tab label.
- **Keyboard and assistive integrity:** the tabs expose real tab/tab-panel relationships, one roving tab stop, Arrow-key movement, Home/End, selected state, and labelled panels. Focus and hover use the shared desktop interaction language.
- **Trust boundaries remain visible:** OpenBible Cross References retain their CC-BY attribution, TIPNR retains its CC BY 4.0 attribution, and neither merges with local note-derived connections. Public corpus results and personalized library evidence occupy separately named sections.
- **Repeatable proof:** the Living Margin tour exercises all four views, Overview in all four atmospheres, keyboard movement, per-view state, selection completion, provenance, full Refs/Notes exploration, and tailored content. The study-overlay tour verifies that language, Structure, passage notes, highlights, and OpenBible previews still work through the new view ownership.

**Verification:** `npm run lint`, full `npm test` (**409 tests: 399 passing, 10 expected Electron-ABI skips**), renderer typecheck, Electron build, renderer build, focused Living Margin/study-overlay contracts, `npm run qa:margin`, `npm run qa:study-overlays`, and `git diff --check` pass. The tours preserve the active library at **26 notes and 30 highlights**. Mobile remains outside this worktree.

## Progress — 2026-07-15 (BSB canonical-prose boundary)

A bounded data-integrity repair removed USFM publication structure from the canonical reading text without changing the reader UI or the separate mobile worktree:

- **Root cause repaired at import:** the previous scanner sliced from one `\v` marker to the next and then stripped marker tokens, so payloads such as `\s2 The First Day` survived as the preceding verse's final sentence. The pure core parser now removes structural lines before verse extraction.
- **Structure is preserved, not discarded:** 3,150 BSB section, major-section, description, speaker, and acrostic headings are stored separately with the first governed verse. The importer excludes 5,004 total nonverse structural lines from canonical prose.
- **Psalm numbering remains intact:** a structural line that contains an explicit `\v` remains canonical verse text, protecting all numbered Psalm superscriptions and similar source records.
- **No corpus shrinkage:** the regenerated package still contains 31,086 verses across 1,189 chapters and the same 15 known critical-text omissions relative to the KJV backbone.
- **Regression is exhaustive:** the import Doctor records the exact verse, heading, structural-line, and backbone-delta totals. Tests scan every committed BSB chapter for a heading suffix in verse prose, and the package verifier validates every heading coordinate, kind, and payload.
- **Rendered proof:** after restarting Electron, BSB Genesis 1 rendered 31 verse rows; verses 2, 5, and 8 contained no appended day headings, and a live DOM scan found zero leaked day-heading nodes in the canonical verse layer.

**Verification:** focused USFM tests (**4/4**), `npm run verify:data` (**5,945 chapter files / 155,494 verses**), full `npm test` (**405 tests: 395 passing, 10 expected Electron-ABI skips**), `npm run lint`, Electron build, renderer build, live BSB Genesis 1 DOM assertion, and `git diff --check` pass.

## Progress — 2026-07-15 (Top chrome control refinement)

A focused post-consolidation audit corrected the two remaining ambiguous controls without reopening the wider desktop system:

- **Sidebar ownership is now obvious:** the collapse action no longer floats halfway across the sidebar/content divider like a resize handle. In the expanded sidebar it is a quiet, tooltip-backed action aligned inside the brand header. In the collapsed rail the brand remains at rest and gives way to the expand action only when its header is hovered or keyboard-focused.
- **Reading layout is one glyph:** the broken-looking custom `Aa` plus detached current-size letter was replaced by one line icon combining type and text measure. The 32px control now matches Focus, Study, and atmosphere controls without presenting “Aᵣ M” as accidental text.
- **Geometry is enforced:** sidebar QA proves that the toggle stays inside the rail and shares the brand's vertical center; it captures both collapsed idle and discoverable hover states. Topbar QA proves the new icon exists, the detached size tag does not, and the control remains safe at the 900px desktop floor.
- **Maximized-window-safe QA:** the 900px topbar pass now uses renderer device metrics, so a human-maximized Electron window cannot make the responsive proof fail or be unmaximized behind the user's back.

**Verification:** focused sidebar/topbar/shared-control/consolidation contracts (**14/14**), `npm run qa:sidebar`, `npm run qa:topbar`, full `npm test` (**401 tests: 391 passing, 10 expected Electron-ABI skips**), `npm run lint`, renderer typecheck/build, four-atmosphere screenshot inspection, and `git diff --check` pass. Mobile remains outside this worktree.

## Progress — 2026-07-15 (Desktop consolidation)

The tenth and final bounded desktop visual-system pass is complete. It closes the gap between the rendered interface, its durable design contract, and its automated evidence without broadening into mobile, source-shelf/PDF ingestion, or sync:

- **One durable visual contract:** `design-tokens.json` now describes the same warm Paper/Ink system, 6/12/20px geometry, restrained elevation, layout dimensions, motion, and four reading atmospheres that the renderer actually uses. The obsolete cool prototype palette and accent experiments are gone.
- **No accidental component styling:** one-off chrome colors, mid-register radii, scrims, and shadows now resolve through named tokens. Static inline layout/cursor styles and hard-coded SVG colors were removed; the remaining inline styles are exclusively runtime geometry, position, duration, direction, or data visualization values.
- **Confirmed mutation states:** library actions and grounded-claim saving use `safeCall`, expose busy and inline failure states, disable duplicate submissions, and report success only after the host confirms the write. No native `alert()` or `confirm()` remains in the renderer.
- **One complete regression command:** `npm run qa:desktop` runs the existing Sidebar, Topbar, Reading canvas, Living Margin, Shared controls, Setup, Notebook, and Study overlays suites in sequence. It covers Paper, Ink, Glass, Candlelight, desktop-floor layouts, keyboard/focus behavior, floating layers, error/empty/loading paths, and real study interactions.
- **Non-destructive proof:** the aggregate tour completed all eight suites and restored the active library at **26 notes and 24 highlights**. Representative final captures were visually inspected across all four atmospheres, and the screenshot corpus was refreshed rather than replaced by a one-off claim.

**Verification:** `npm run qa:desktop` (**8/8 suites**), full `npm test` (**401 tests: 391 passing, 10 expected Electron-ABI skips**), focused consolidation contracts, `npm run lint`, `npm run typecheck:renderer`, Electron build, renderer build, and `git diff --check` pass. `verify:m2` remains Node-ABI-gated while the live Electron runtime uses its Electron-built native module; it was intentionally not rebuilt during the visual-QA session.

B2 is complete within its declared desktop scope. PDF/source-shelf ingestion remains B4, sync remains C2, plugin management remains C3, and mobile remains D1 in its separate worktree.

## Progress — 2026-07-15 (Shared controls and floating layers)

The sixth bounded desktop visual-system pass is complete. It consolidates the state and material language beneath the interface without redesigning Settings, onboarding, import, or the proven study visualizers:

- **One action and field contract:** shared typed Button/Input/Textarea primitives now cover primary, secondary, ghost, danger, size, busy, disabled, pressed, invalid, and visible-focus states. Existing `.btn-primary` / `.btn-secondary` callers receive the same geometry until their bounded surface migrations land.
- **Keyboard-complete choices:** Reading layout now uses a reusable single-tab-stop segmented radio group with Arrow, Home, and End movement, selected material, and a quiet gold state mark.
- **Lightweight floats:** anchored pickers no longer dim and blur the whole reading desk. Popovers are named, viewport-clamped, resize-safe, initially focused without animation-frame dependence, Escape-dismissible, and optionally modal when a surface truly needs containment.
- **Discoverable icon tools:** Reading layout, focus mode, chapter movement, Study visibility, and atmosphere use delayed pointer/keyboard tooltips with accessible descriptions and optional shortcut labels instead of relying only on native title bubbles.
- **Reliable status:** Toasts now carry neutral/success/warning/error tone, polite/assertive live-region behavior, action/dismiss states, a bounded progress line, exit motion, timer cleanup, and the correct Paper/Ink/Glass/Candlelight material outside the app shell.
- **Modal integrity:** note capture uses shared controls, traps Tab/Shift+Tab, announces validation, and restores focus to the invoking control or the originating Scripture verse when the transient selection toolbar has disappeared.
- **Repeatable non-mutating QA:** `npm run qa:controls` exercises real popover focus, segmented keyboard movement, Escape return, modal containment/recovery, keyboard tooltip disclosure, library menu rows, and all four atmospheres. A CSS-only toast fixture verifies the visual layer without creating a note or highlight. Captures live in `docs/ui-audit/shared-controls/`.

**Verification:** `npm run lint`, full `npm test` (**389 tests: 379 passing, 10 expected Electron-ABI skips**), focused shared-control/topbar contracts, renderer build, the self-driving all-atmosphere controls tour, and `git diff --check` pass. `verify:m2` remains Node-ABI-gated while the live Electron runtime uses ABI 133; the native module was intentionally not rebuilt out from under the running visual-QA app.

The next bounded component is **Settings, onboarding, and import**. Mobile remains explicitly outside this worktree.

## Progress — 2026-07-15 (Settings, onboarding, and import)

The seventh bounded desktop visual-system pass is complete. It replaces the disconnected setup surfaces with one ownership-first library workflow while leaving source ingestion internals, sync, and mobile outside this pass:

- **One navigable Settings workspace:** Library, Reading, Intelligence, Import, and About share one H1, helper copy, scroll-aware section rail, and restrained row geometry. The rail compacts horizontally at the supported 900px desktop floor without covering headings or introducing horizontal overflow.
- **Truthful local-library status:** Settings reports the active path and real library summary, exposes Show in Finder, Switch Library, and Rebuild Index as explicit actions, and lists all five bundled reading texts with their names and license posture.
- **Shared reading controls:** atmosphere, text size, measure, and verse-number choices use the keyboard-complete segmented primitive. The four atmospheres keep identical structure and meaning.
- **Deliberate intelligence limits:** network permission, operating mode, daily token limit, current usage, and job behavior are explained separately. Editable limits save explicitly rather than on each digit, and every IPC outcome uses shared busy/toast feedback instead of `alert()`.
- **Staged non-destructive import:** the user chooses a vault, reviews that the source will remain unchanged, and then starts import. Progress, completion, importer error, transport error, retry, and start-over states are all designed.
- **Ownership-first onboarding:** first run now explains plain files, local-by-default storage, and portability before asking for a location. Recommended and custom paths are visible before initialization, with busy and recovery states on the real actions.
- **Repeatable isolated QA:** `npm run qa:setup` covers all five Settings sections in Paper, Ink, Glass, and Candlelight, keyboard choice behavior, the 900px desktop floor, and a separate temporary first-run Electron profile. Captures live in `docs/ui-audit/setup/`.

**Verification:** `npm run lint`, full `npm test` (**390 tests: 380 passing, 10 expected Electron-ABI skips**), renderer build, `npm run qa:setup`, and `git diff --check` pass. PDF/source-shelf ingestion remains B4 work, sync remains C2 work, and mobile remains outside this worktree.

The next bounded component is **Write, Notes, and Search**.

## Progress — 2026-07-15 (Write, Notes, and Search)

The eighth bounded desktop visual-system pass is complete. It turns three prototype-era destinations into one coherent local notebook without adding autonomous writes, note deletion, source ingestion, sync, or mobile behavior:

- **Draft-preserving authoring:** App now owns the active title/body draft, so moving through Read, Notes, or Search no longer discards unfinished work. Passage capture appends to the same draft. Saving remains explicit through Save note or `Command-S`; there is no autosave or background Substrate mutation.
- **Recoverable save behavior:** note creation is wrapped in `safeCall`, keeps the complete draft on transport or application failure, reports busy/error/success through the shared controls and toast system, and clears only after a confirmed save.
- **Quiet writing desk:** Write has one named workspace, plain-Markdown/local trust copy, a focused title/body sheet, word and character measure, and a restrained saved-note enrichment surface. Suggested Scripture anchors remain post-save, visibly AI-inferred, and individually confirmed or dismissed by the user.
- **Readable note library:** Notes sorts the real library by modified date, filters title/body/tags locally, and opens a selected note in a persistent reading detail instead of unexpectedly leaving the workspace. The detail preserves Markdown-shaped headings, quotes, and lists; exposes tags and measures; and turns every parsed Scripture reference into an explicit return-to-reading action.
- **Real retrieval hierarchy:** Search uses the existing FTS index with a debounced, request-sequenced flow, recently modified notes before a query, shared note detail after selection, highlighted matches, clear/retry actions, and deliberate loading, error, and no-result states. No implementation-facing `FTS5` copy remains.
- **Complete desktop keyboard path:** Arrow Up/Down and Home/End move and select note rows; Escape clears filter/search; `Command-S` saves from either writing field. Focus, selection, and search emphasis keep the same restrained gold contract as the reading desk.
- **Non-mutating visual QA:** `npm run qa:notebook` checks draft persistence, note-list keyboard movement, real indexed search/detail agreement, Paper/Ink/Glass/Candlelight captures, and Write/Notes/Search at 900×700. The active library contained 26 notes before and after the tour.

**Verification:** `npm run lint`, full `npm test` (**393 tests: 383 passing, 10 expected Electron-ABI skips**), renderer build, focused notebook contracts, `npm run qa:notebook`, and `git diff --check` pass. Note editing/deletion is not invented by this visual pass; PDF/source-shelf ingestion remains B4, sync remains C2, and mobile remains outside this worktree.

The next bounded component is **Study overlays**.

## Progress — 2026-07-15 (Study overlays)

The ninth bounded desktop visual-system pass is complete. It aligns the study drill-downs as one calm system without changing the proven language, senses, syntax, cross-reference, or authored-data semantics:

- **Source-text language hierarchy:** the interlinear now reads as a continuous source line with one quiet selected word. The word card uses restrained neutral material, a short gloss, and progressive Definition, word-map, grammar, Structure, usage, and provenance layers rather than stacked decorative cards.
- **Keyboard-complete word maps:** In English, Behind this word, and Senses now expose stable tab/tab-panel relationships, one roving tab stop, Arrow/Up/Down/Home/End movement, and a quiet count line. Quantitative rings and the source-shaped Senses outline remain semantically unchanged.
- **Exact-material Structure:** the full-workspace portal mirrors the complete Paper/Ink/Glass/Candlelight class set instead of only light/dark. Its heading, loading/unavailable states, close/done focus path, and MACULA + Clear Bible / CC BY 4.0 provenance now share the desktop hierarchy while Clause, Sentence map, Diagram, and Outline remain untouched.
- **Reliable floating study tools:** the highlight toolbar is flatter, labels its color group and Add note action, and now portals above the Glass/Candlelight backdrop-filter canvas. This fixes Chromium compositor clipping and pointer failure in the two glass atmospheres rather than masking it in QA.
- **Trust-forward passage capture:** the compact note panel leads with the reference, visibly states `Plain Markdown · saved locally only when you choose`, preserves the quoted passage, and leaves the user's note body empty until they write. Save remains explicit.
- **Visible relationship provenance:** OpenBible is adjacent to exact verse/passage scope in the Cross references heading; destination previews remain clickable, range-preserving, and separate from local note-derived connections. Rows use a quiet list rhythm rather than oversized cards.
- **Repeatable non-mutating QA:** `npm run qa:study-overlays` captures highlight, note, language/senses, Structure, and OpenBible surfaces in all four atmospheres plus the 900×700 desktop floor. It proves exact Structure material, roving-tab focus, portal hit-testing, no horizontal overflow, and unchanged active-library counts (**26 notes, 24 highlights**). Captures live in `docs/ui-audit/study-overlays/`.

**Verification:** `npm run lint`, full `npm test` (**397 tests: 387 passing, 10 expected Electron-ABI skips**), Electron build, renderer build, focused study-overlay contracts, `npm run qa:study-overlays`, and `git diff --check` pass. Mobile, source-shelf/PDF ingestion, sync, and changes to proven language/syntax data remain outside this bounded pass.

The next bounded component is **Consolidation**.

## Progress — 2026-07-15 (Living Margin frame)

The fifth bounded desktop visual-system pass is complete. It turns the right rail into one calm, stateful study companion while preserving the proven language, cross-reference, senses, and Structure visualizers:

- **One persistent frame:** a sticky `Study` heading and truthful `Chapter | In view | Selected` label make the panel's context legible without adding a dashboard card or colored edge.
- **A real chapter overview:** the top of the reading canvas now keeps chapter context visible. Moving into Scripture follows the reading eye-line; returning to the top restores the overview. Scroll handling releases old language-study locks and self-corrects stale pointer state instead of freezing on an earlier verse.
- **A finishable selection flow:** selected passages expose one quiet `Done` action, five familiar highlight swatches, and note capture. `Done` clears the passage and restores keyboard focus to the persistent frame heading.
- **Progressive reading context:** long multi-verse quotations collapse to four lines with a deliberate full-selection toggle. Secondary related notes, themes, and grounded claims live under one collapsed `More from your notes` disclosure rather than forming a permanent card parade.
- **Truthful evidence scope:** selected-passage insight never falls back to chapter-wide semantic results while its scoped retrieval is loading. OpenBible connections keep their own source/license and range scope; note-derived insight and connections remain explicitly attributed to the local library.
- **Quieter material language:** section rhythm, headings, note surfaces, counts, loading, highlight tools, empty states, and disclosures use hairlines, warm type, and restrained gold interaction cues across Paper, Ink, Glass, and Candlelight.
- **Repeatable interaction QA:** `npm run qa:margin -- --leave=light --leave-package=kjv --leave-passage="Genesis 1"` verifies all three panel modes, long-selection expansion, all four atmospheres, OpenBible attribution, scoped note provenance, secondary disclosure, and focus recovery without creating, deleting, or recoloring authored data. Captures live in `docs/ui-audit/living-margin/`.

**Verification:** `npm run lint`, full `npm test` (**384 tests: 374 passing, 10 expected Electron-ABI skips**), Electron build, renderer build, the self-driving Living Margin tour, and `git diff --check` pass.

The next bounded component is **Shared controls and floating layers**. Mobile remains explicitly outside this worktree.

## Progress — 2026-07-15 (Reading canvas)

The fourth bounded desktop visual-system pass is complete. It turns the chapter body into a deliberate long-form reading surface without changing Living Margin content, study-overlay semantics, or the separate mobile worktree:

- **Scripture-first hierarchy:** the chapter is now a semantic labelled article with a real heading, a restrained 36–44px book/chapter landmark, and responsive reading measure. Ambient note-derived theme tags are no longer mixed into the canonical text surface.
- **Quieter verse rhythm:** every row uses a stable number gutter and Source Serif text column. Hover is a faint material wash; focus uses a short gold rail instead of a perimeter; multi-verse selection does not paint over the existing source-colored SVG highlight layer.
- **Deliberate non-content states:** loading has an announced status and reduced-motion-safe skeleton; error gives a useful retry with collapsed technical detail; empty text states explain what is absent and offer a check-again action.
- **Complete spatial keyboard flow:** Arrow Up/Down traverse real verses, Home/End move to the chapter boundaries, and Enter/Space preserve selection behavior. Chapter changes reset reading position, while bottom continuation moves focus to the next chapter heading.
- **Calm chapter continuity:** a minimal end marker and `Continue to …` action replace the previous dead stop without turning the reader into a paginated card interface.
- **Repeatable visual QA:** `npm run qa:canvas -- --leave=light --leave-package=kjv --leave-passage="Genesis 1"` verifies semantic structure, hover/focus/range selection, all four atmospheres, focus mode, chapter continuation, and the 900px desktop boundary. Captures live in `docs/ui-audit/reading-canvas/`.

**Verification:** `npm run lint`, full `npm test` (**379 tests: 369 passing, 10 expected Electron-ABI skips**), Electron build, renderer build, the self-driving canvas tour, and `git diff --check` pass.

The next bounded component is the **Living Margin frame**. Mobile remains explicitly outside this worktree.

## Progress — 2026-07-15 (Reading topbar)

The third bounded desktop visual-system pass is complete. It turns the reading topbar into one stable command surface without changing the reading canvas, Living Margin content, or mobile worktree:

- **Stable two-zone architecture:** passage movement stays in a left location zone and reading tools stay in a right tool zone. Living Margin visibility no longer reserves or releases a 300–400px spacer, so neither zone jumps when the margin opens or closes.
- **Faster passage movement:** book/chapter, Previous/Next, and translation selection use one restrained control register. The passage field is now a clear `Jump to passage` command with a visible `⌘K` shortcut, Escape recovery, and a concise example when a reference cannot be parsed.
- **Truthful reading controls:** Reading layout explains that presentation changes while text does not; translation selection explains that notes remain anchored; focus mode promises to hide side panels rather than falsely claiming to hide all chrome.
- **Complete keyboard behavior:** picker triggers expose their dialog state, every floating layer is named, keyboard focus enters the book search where appropriate, and Escape closes each picker before returning focus to its originating control.
- **Desktop-safe compression:** below 1120px the passage label and dormant jump command compact without removing capabilities. At the supported 900px desktop floor the location and tool zones remain distinct; focusing the jump field expands it without overlap.
- **Repeatable visual QA:** `npm run qa:topbar -- --leave=light` verifies stable margin geometry, hover, focus return, jump error/recovery, focus mode, scroll depth, 900px compression, and Paper/Ink/Glass/Candlelight materials. Captures live in `docs/ui-audit/topbar/`.

**Verification:** `npm run lint`, full `npm test` (**375 tests: 365 passing, 10 expected Electron-ABI skips**), Electron build, renderer build, `npm run qa:topbar -- --leave=light`, and `git diff --check` pass.

The next bounded component is **Reading canvas**. Mobile remains explicitly outside this worktree.

## Progress — 2026-07-15 (sidebar and primary navigation)

The second bounded desktop visual-system pass is complete. It converts the sidebar from a layout experiment into production navigation without changing the reading canvas, topbar, Living Margin, or mobile worktree:

- **One deliberate density:** the visible `Original | Compact | Rail` lab and its persisted `sidebarStyle` setting are removed. The final sidebar is 228px expanded and a 64px collapsed rail, with the existing collapse preference retained.
- **Clear identity hierarchy:** the top row is now the static Scripture product identity. Library selection lives once, in a full-width footer switcher, rather than being duplicated on the wordmark and avatar.
- **Quiet navigation states:** the current destination uses a neutral inset surface with one gold icon instead of a shadow plus a second gold edge. Hover is a low-contrast material change; keyboard focus remains fully visible; 1–5 hints appear only on the relevant hovered or focused row.
- **Truthful footer state:** idle copy is `Local library`, not the sync-like `Up to date`. The active analysis state is `Studying passage…`; the footer avatar continues to pulse while work is running. The library panel uses a labeled dialog relationship, reports installed texts, and presents its actions as a compact menu rather than three heavy outlined buttons.
- **Repeatable interaction QA:** `npm run qa:sidebar` asserts the chosen widths, absence of the layout lab, single library trigger, active-page semantics, 1–5 keyboard navigation, hover shortcut reveal, keyboard focus, collapse/expand, Escape dismissal, and all four atmosphere materials. Captures live in `docs/ui-audit/sidebar/`.

**Verification:** `npm run lint`, full `npm test` (**372 tests: 362 passing, 10 expected Electron-ABI skips**), Electron build, renderer build, `npm run qa:sidebar`, and `git diff --check` pass.

The next bounded component is **Reading topbar**. Mobile remains explicitly outside this worktree.

## Progress — 2026-07-15 (desktop visual-system foundation)

The first bounded pass of the whole-interface refinement is complete. It establishes the shared material and interaction foundation without changing the proven language, Structure, cross-reference, or highlight semantics:

- **Four coherent reading atmospheres:** the persisted two-state light/dark setting is now `Paper | Ink | Glass | Candlelight`. Paper and Ink use warm solid materials; Glass and Candlelight use suite-owned Shepherdly background assets under translucent surfaces. All four retain identical geometry and meaning.
- **Clearer product language:** the control is **Reading atmosphere**, with the promise **Material changes. Meaning does not.** Each option now explains the reading experience instead of exposing implementation terms.
- **One interaction identity:** the former blue/green/plum chrome preference is retired. Gold is reserved for action, focus, and current state; highlights and diagrams retain their data-semantic colors.
- **Unified foundation:** warm paper/ink text ladders, 6/12/20px geometry, restrained elevation, 150ms transitions, and Source Serif / Inter / JetBrains Mono roles now govern the shell. Settings uses a quiet reading sheet so glass imagery never competes with controls.
- **Reliable floating layers:** shared Popovers now portal above backdrop-filter surfaces while inheriting the active atmosphere. This fixes Electron compositor clipping in both glass modes and improves every existing picker, not only the new one.
- **Repeatable desktop QA:** `scripts/qa-theme-tour.mjs` verifies and captures the shell, atmosphere picker, and Settings in all four looks. `qa-screenshot-tour.mjs` now covers all four atmospheres and successfully captured Greek and Hebrew language cards across every pill.

The governing contract and bounded continuation order are in `docs/desktop-visual-system.md`.

## Progress — 2026-07-15 (OpenBible cross-reference study surface)

The Living Margin now uses the complete scored OpenBible snapshot rather than the tiny TSK stand-in:

- **Complete, reproducible corpus:** 344,799 scored edges across 66 books are retained in a normalized JSONL artifact, including 3,512 non-positive and lower-ranked edges. The reader filters non-positive scores only at query time; it never destroys them on import.
- **Verse and passage reading modes:** exact verses return a compact top ten. Passage selections aggregate their constituent verse relationships into a top eight, preserve destination ranges, expose multi-verse support, and avoid self-links.
- **Truthful provenance:** OpenBible has its own CC-BY attribution and remains visually separate from suggestions derived from the reader's notes. The UI does not manufacture quotation, parallel, theme, or prophecy labels because the source dataset has no per-edge taxonomy.
- **Quiet interactive treatment:** rows use translation previews, full-row click targets, restrained warm hover/focus states, and a small gold `Open` affordance. Opening a same-chapter destination range selects every verse in the range.
- **Doctor and regression gates:** import checks cover canonical coordinates, coverage, duplicate edges, range integrity, license, snapshot date, and exact score preservation. Core tests cover filtering, verse limits, passage aggregation, ranges, attribution, and the committed full-corpus totals.

**Verification:** `npm run lint`, `npm run verify:data`, `npm run verify:m2`, all 370 tests under the Node ABI, Electron/renderer builds, and self-driving light/dark verse + passage tours pass. No mobile-specific work was added.

## Progress — 2026-07-14 (Structure minimalist visual refinement)

The desktop Structure component now uses one quiet visual language across Clause, Diagram, Outline, and Sentence map instead of color-coding grammatical roles:

- **Neutral hierarchy:** the multicolor phrase-card edges, colored role labels, accent clause rails, selected diagram paths, and Outline focus rails are gone. Spacing, surface tone, border weight, and source typography now carry the hierarchy.
- **Restrained selection:** the exact selected source word keeps the sole semantic accent underline. Selected clauses, cards, nodes, and paths use neutral contrast; keyboard focus remains visible with a high-contrast neutral ring rather than a blue perimeter.
- **Consistent chrome:** Structure tabs, source summary, navigation, local `Diagram | Outline` switch, modal controls, and the Done action use the same flat neutral surfaces. Decorative inset edges and accent shadows were removed.
- **Desktop-only QA:** no mobile-specific work was added. The self-driving Electron tour verified Romans 1:5 and Genesis 1:1 across Clause, Diagram, Outline, direct navigation, and conditional Sentence map in both themes. Final captures live under `docs/ui-audit/structure/structure-minimal-greek-*` and `structure-minimal-hebrew-final-*`.

**Verification:** `npm run typecheck`, renderer build, `npm test`, `git diff --check`, and live Greek/Hebrew light/dark Electron tours pass. The full suite reports 367 tests: 357 passing and 10 expected Electron-ABI skips.

## Progress — 2026-07-14 (Structure continuous navigation)

Structure now reads as one continuous desktop study journey instead of requiring Sentence map as an intermediate navigation screen:

- **Direct Clause movement:** Clause detail has a persistent Previous/Next navigator from first open, with destination previews, `Clause n of n`, selected-versus-browsing context, explicit sentence boundaries, and a one-click return to the selected-word clause. Sentence map remains available as an overview, but is no longer required to move through the sentence.
- **Direct Phrase movement:** Phrase detail has its own Previous/Next sequence across every real branched phrase in the sentence, including clause boundaries. Single-word groups remain absent because they have no diagrammable source branch. The center context shows both `Phrase n of n` and its current clause.
- **Truthful reading order:** phrase stops sort by the earliest real source-word position, not by the hierarchical clause array. An embedded clause between two parent phrases therefore appears between them in the reading journey instead of forcing a forward-then-backward jump.
- **Continuity and recovery:** a reader's explicit `Diagram | Outline` choice persists while stepping through phrases; return-to-selection distinguishes the exact selected phrase when one exists from the broader selected clause; opening Phrase detail receives quiet programmatic focus and returning to Clause restores focus to the originating group.
- **Keyboard and copy:** `Option+Left/Right` mirrors the visible Previous/Next controls without colliding with the diagram's unmodified parent/child/sibling arrows. The source summary now reports the grammatical group (`Verb`, `Subject`, and so on) instead of falsely calling every selected group a phrase.
- **Desktop-only visual QA:** no mobile work was added. Final light/dark Electron captures for long Greek and mirrored Hebrew journeys live under `docs/ui-audit/structure/structure-nav-final-romans-*` and `structure-nav-hebrew-*`; the self-driving tour adds `--progress` for direct navigation captures.

Focused model and renderer-contract tests cover source-position ordering across embedded clauses, real-phrase-only stops, direct clause/phrase controls, keyboard scoping, view persistence, and focus restoration.

**Verification:** `npm run lint`, `npm test`, `npm run verify:data`, Electron build, renderer build, live light/dark Greek and Hebrew navigation tours, and `git diff --check` pass. The full suite reports 367 tests: 357 passing and 10 expected Electron-ABI skips.

## Progress — 2026-07-14 (Spatial Phrase diagram completion)

Phrase detail now includes the real spatial branch diagram that the earlier vertical outline did not provide. This remains a desktop-only refinement inside the existing Structure component; Clause and Sentence map are unchanged.

- **Diagram + Outline, not a third top-level tab:** a genuinely branched Clause group opens Phrase detail with a local `Diagram | Outline` switch. Diagram is the visual constituency view; Outline is the complete, vertically scannable source structure. Compact phrases open in Diagram. Linked chains and unusually wide, deep, or large phrases open in Outline while retaining Diagram as an explicit focused projection.
- **Measured spatial layout:** platform-neutral core code lays out renderer-measured HTML nodes over an SVG connector layer. Parents center above their children, all terminal words share a baseline, source order is stable, Hebrew geometry mirrors RTL, and text is never shrunk to force a tree into view.
- **Honest adaptive projection:** compact phrases show every node. Wide/deep structures keep the exact selected lineage, replace off-path subtrees with labeled earlier/later branch summaries, and link directly to the complete Outline. Luke 3's 154-item genealogy becomes a three-node lineage (`133 earlier items | Noah | 20 later items`) instead of an unreadable star or staircase.
- **Visible provenance:** study nodes retain source ids/rules plus compression provenance. Solid connectors mean a direct displayed source branch. Dashed connectors mean a condensed source path—unary parser wrappers, recursive presentation compression, or an explicit focus-window summary—so visual cleanup never masquerades as exact source geometry.
- **Interaction:** the selected word and its ancestor path receive the only strong accent. Clicking another node updates the quiet inspector; summary nodes open Outline; embedded-clause terminals expose `Open clause →` and navigate to the real Clause surface. Keyboard traversal supports parent/child/sibling arrows, `Home` to the selected word, and `Escape` back to Clause.
- **Grammar correction from the specialist audit:** MACULA's `O` under passive Greek `ὁρίζω` is now labeled **Predicate complement** when the surface has passive morphology, so Romans 1:4 renders `Υἱοῦ Θεοῦ` as the role assigned by “having been declared,” not as a direct object. The correction is lexical/voice-shaped, not verse-specific.
- **Corpus hardening:** first/middle/last focus probes across every shipped Greek and Hebrew sentence exercised 44,000 real Phrase details. All retained the exact selected leaf, unique projected ids, bounded fan-out (four complete / three focused), and non-negative hidden counts: 42,769 complete diagrams and 1,231 outline-first exceptional shapes.
- **Visual QA:** final light/dark Electron captures cover compact Greek (`syntax-spatial-greek-final2-*`), mirrored Hebrew (`syntax-spatial-hebrew-final-*`), wide focus projection (`syntax-spatial-wide-final-*`), genealogy lineage (`syntax-spatial-lineage-final-*`), and diagram-to-embedded-Clause navigation (`syntax-spatial-embedded-final-*`) under `docs/ui-audit/structure/`.

Focused diagram/model/corpus tests cover deterministic layout, non-overlap, terminal baselines, RTL mirroring, focus preservation, projection summaries, provenance, Romans 1:4, Luke 6 late-item selection, Luke 3 lineage, and embedded navigation.

**Verification:** `npm run lint`, `npm test`, `npm run verify:data`, Electron build, renderer build, the 44,000-detail corpus projection audit, and `git diff --check` pass. The full suite reports 362 tests: 352 passing and 10 expected Electron-ABI skips.

## Progress — 2026-07-14 (Structure corpus hardening + Phrase outline completion)

The desktop Structure outline/corpus loop is complete across ordinary and pathological Greek/Hebrew source shapes. The exhaustive vertical form remains as **Outline** inside source-backed Phrase detail beneath the primary Clause view:

- **Corpus-safe outlines:** direct and alternating recursive `NPofNP` / apposition spines collapse into one truthful dependent chain without dropping or duplicating leaves. Luke 3's former 154-level genealogy is now a shallow branch with an 11-item focus window and explicit `Show all 154 items`; 20+ child Greek/Hebrew coordination shapes use the same adaptive preview.
- **Grammatical precision:** ordinary `O` remains **Object**; explicit `O2` and `OC` render **Second object** and **Object complement**; only clauses with an explicit copular lemma reinterpret source `O` as **Predicate**. `NPofNP` is labeled **Head + dependent**, and non-nominal source shapes never manufacture an English “of.” Common MACULA rules now receive grammatical relationship labels while unknown rules remain neutral.
- **Real outline navigation:** all 10,159 retained embedded-clause markers resolve to visible clauses and expose `Open clause →`. Three empty Hebrew parser wrappers with no lexical content or destination are omitted instead of becoming dead controls. A browsed clause is visually distinct from the selected-word clause and offers `Return to selected clause`.
- **Adaptive reading surfaces:** Sentence map and deep Phrase detail auto-reveal the selected clause/leaf; long original lines and already-composed source glosses receive focus-aware compact previews; clause depth is visually capped without flattening the model; indented Sentence map rows no longer create horizontal overflow. Dark instructional text meets the modal's readable contrast level.
- **Desktop-only boundary:** no mobile implementation or screenshots were added. The Electron tour now also exercises embedded-clause navigation with `--embedded`.

Focused and shipped-corpus tests cover Genesis 1:2 copular syntax, Greek/Hebrew `O2`/`OC`, Luke 3 genealogy depth and leaf integrity, Luke/Joshua wide coordination, non-nominal `NPofNP`, missing-focus refusal, and empty embedded scaffolding. Final light/dark Electron captures cover Genesis 1:2 (`syntax-final-hebrew-*`), Romans 1:5 (`syntax-final2-romans-*`), Luke 3:23–38 (`syntax-final3-genealogy-*`), and Luke 6:13–16 including live tree-to-clause navigation (`syntax-final-embedded-*`) under `docs/ui-audit/structure/`.

**Verification:** `npm run lint`, `npm test`, `npm run verify:data`, `npm run build`, renderer build, corpus-wide embedded-target audit, and `git diff --check` pass. The full suite reports 353 tests: 343 passing and 10 expected Electron-ABI skips.

## Progress — 2026-07-14 (Structure Phrase detail + desktop interaction)

The Tree idea returned as an honest advanced drill-down instead of a misleading peer tab:

- **Real Phrase detail:** multi-word Clause groups expose `phrase detail →` only when MACULA contains a genuine branch. The model collapses unary parser scaffolding but preserves noun/prepositional/verb phrase nesting, coordination, determiner relationships, `NPofNP` head-dependent structure, source order, and embedded-clause boundaries. Single-word groups do not claim a tree.
- **Progressive disclosure:** Phrase detail opens inline from its Clause group and uses a compact vertical tree with focus-path rails, one exact selected leaf, full source forms, rough glosses, and plain grammatical relationship labels. Greek geometry is LTR; Hebrew branch geometry mirrors RTL while English UI copy remains LTR.
- **Sentence map navigation:** every clause row now has a quiet `open →` affordance and opens directly into that clause's source-order Clause detail. The original selected-word clause remains marked separately from a clause the reader chooses to inspect.
- **Desktop-only boundary:** this pass intentionally adds no phone work or phone screenshots; mobile refinement belongs to its separate worktree. The self-driving desktop tour now verifies Phrase detail and Sentence map navigation with `--phrase` and `--navigate`.

Focused model tests cover Greek prepositional/genitive nesting, Hebrew construct phrases, unary-wrapper collapse, single-word suppression, selected-leaf integrity, and embedded-clause refusal. Desktop Electron QA covers Luke 4:14 and Genesis 1:2 in both themes; final captures live under `docs/ui-audit/structure/structure-final-*` and `phrase-greek-final2-*`.

**Verification:** `npm run lint`, `npm run verify:data`, Electron build, renderer build, and `git diff --check` pass. The full suite reports 340 tests: 330 passing and 10 expected Electron-ABI skips.

## Progress — 2026-07-14 (Structure truth + mobile refinement)

The Structure study was corrected after a corpus-wide linguistic and visual audit:

- **Hebrew integrity:** the handwritten XML scanner was replaced by a real host-layer DOM parser, including correct self-closing `<m/>` handling. Regenerated MACULA Hebrew now contains 23,213 sentences / 474,205 clean leaves with zero XML leakage. `verify:data` asserts leaf/token parity and forbids markup in every Greek and Hebrew surface.
- **Exact focus or no result:** the Hebrew loader no longer falls back to the first Strong&rsquo;s match or first sentence leaf. Contextual word-position/Strong&rsquo;s/surface matching resolves 301,668 of 306,774 OSHB words (98.34%); unresolved words return no Structure result instead of a false highlight.
- **Truthful language:** embedded clauses stop at their own gloss boundary; visible roles are grammatical (`Subject`, `Verb`, `Object`, `Indirect object`, `Modifier`, `Predicate`, `Connector`, `Phrase`); neutral clause labels replace inferred main/supporting relationships; source-order gloss fragments are explicitly labeled as rough glosses, not translation.
- **Progressive disclosure:** **Flow** is now **Clause**, the primary selected-clause reading surface. **Outline** is now **Sentence map** and appears only for sentences with multiple clauses. The flat role-to-word **Tree** was removed until a real nested Phrase detail can be built.
- **Mobile:** the modal becomes a full-screen, safe-area-aware 390px study sheet; Clause groups stack vertically; Sentence map keeps source direction and hierarchy; labels and instructional text retain contrast in dark mode. The self-driving QA tour supports `--mobile` captures and the final Greek, Hebrew, and single-clause screenshots live under `docs/ui-audit/structure/structure-truth-*`.

**Verification:** strict TypeScript/renderer/embedding lint, focused parser/focus/model tests, `verify:data`, Electron build, renderer build, and `git diff --check` pass. Browser QA covers Romans 1:5, Genesis 1:2, and Luke 4:14 in both themes at desktop and 390×844 phone width.

## Progress — 2026-07-14 (Structure study: Tree / Flow / Outline)

The original-language **Structure** modal was rebuilt around three distinct study questions instead of three variations of the raw MACULA parse tree:

- **Tree — how is the selected clause built?** The chart is focus-first and limits itself to the selected clause. It branches into stable pastor-facing functions (`Who`, `Action`, `What`, `Context`, `Description`, `Link`) and then real source words, preserves RTL reading order, centers the selected word, and states its scope when the source sentence is larger than the clause.
- **Flow — how does the sentence move?** This is now the default view. Each clause is a restrained card of meaningful phrase groups in source reading order, rather than one card per token. Long source sentences auto-center the selected clause; the selected phrase and word remain visible without suggesting that cards are clickable.
- **Outline — how do the clauses relate?** The complete sentence becomes a compact clause hierarchy with labeled role fragments and the source-language clause beneath. It no longer presents stitched leaf glosses as polished English. Long outlines auto-center the selected clause while retaining the surrounding structure.
- **Shared semantic model:** renderer-independent core code collapses parser-only clause wrappers, interprets MACULA `S` under a clause as subject (not sentence), retains sentence-level conjunctions as visible `Link` groups, omits Hebrew object markers from English summaries while preserving their source words, and reads Hebrew `NPofNP` constructs as relationships (for example `Spirit of God`).
- **Exact focus:** OSHB token ids are resolved to MACULA Hebrew leaves by verse, Strong's, normalized surface, and—critically—orthographic word position, so the second occurrence of an identical Strong's token focuses the second occurrence rather than the first.
- **Interaction and theme:** Flow opens first; tabs use roving keyboard focus with Arrow/Home/End behavior and proper tab/tabpanel semantics. The modal traps focus, restores it on close, animates out, and mirrors the app theme across its body portal so dark mode no longer renders a light dialog.
- **Repeatable visual QA:** `scripts/qa-structure-tour.mjs` drives a read-only Electron tour, accepts a repeated-word occurrence number, and captures all three modes in both themes under `docs/ui-audit/structure/`.

**Verification:** `npm run lint`, `npm run verify:data`, Electron build, renderer build, and `git diff --check` pass. The full suite passes 324 tests with 10 expected Electron-ABI skips (334 total). Browser QA covers Romans 1:5 `ἐλάβομεν` (81-word / 8-clause sentence), both Luke 4:14 sentences (`Πνεύματος`, `περὶ`), Genesis 1:2 `רוּחַ` (RTL, three linked clauses), and the second of two identical `עַל` occurrences. Every Tree / Flow / Outline view was inspected in light and dark themes; final captures use the `*-final-*` names under `docs/ui-audit/structure/`.

## Progress — 2026-07-14 (language-card orbit visual + data-integrity pass)

The original-language card's three orbit modes received a screenshot-driven correction pass without broadening the surrounding B2 surfaces:

- **Forward labels:** inflection stems remain internal grouping keys; every visible band now uses the most frequent real gloss in its group. John 3:16's G25 card renders `Love` / `Let Love`, never the previous `Lov` / `Lof` / `Belove` fragments.
- **Reverse card:** `whole Bible` moved beside the use count and only `BSB`/`AKJV` remains in the hub. Runtime ring construction drops alignment bands only when `count <= 1` and share is below 1%; the stored reverse index remains unchanged.
- **Senses:** the view adapts to each language's real source shape instead of forcing one presentation across both datasets. Hierarchical BDB entries retain the restrained nested accordion: primary senses stay visible, subordinate senses sit beneath grammar branches, and the selected form's matching stem opens by default. Greek no longer derives the widget from Thayer's long, inconsistent article typography; Thayer remains complete inside **Definition**. Greek Senses now come from MACULA's occurrence-level Louw-Nida tags joined to the concise MARBLE SDBG source gloss by exact accent-insensitive `lemma + sense id`. The lemma's corpus range is frequency-ranked, identical source labels collapse, the selected occurrence is marked **here** and always retained inside a six-row visible cap, and one-sense lemmas have no pill. Opening a row repeats the full source label with occurrence count, semantic domain, and quiet attribution. This produces stable concise outlines for `πνεῦμα`, `περί`, `αὐτός`, `λαμβάνω`, `λέγω`, and discourse particles such as `δέ` without verse-specific cleanup or morphology guesses.
- **Card copy and layout:** the header uses the short gloss (`create`) while lexicon prose stays in Definition; the legend gained label width and compact tabular counts; a focused jumpable row shows `open →`; Genesis 1:1 uses `obj. marker` in the strip.
- **Lexicon integrity:** Thayer parsing rejects non-strict/duplicate runs, preserves the full source article, removes the destructive first-line/200-character sense cap, and applies display-only cleanup for glued Latin labels already present in the raw module. BDB Doctor reports the 11 malformed source trees (H100, H167, H310, H2051, H2151, H4116, H5737, H6566, H6887, H6905, H8480), and regenerated data preserves their definition prose without `senses[]`. The MACULA importer now has a semantic-sense Doctor: exact lemma+id conflicts and malformed labels fail import, unmatched upstream combinations are omitted rather than guessed, and the shipped-corpus test scans all 137,779 tokens for clean, stable labels and greater than 90% occurrence coverage.
- **Visual harness:** the self-driving tour now re-pins same-chapter verse targets and avoids unpainted Electron compositor tiles in clipped margin captures.

**Verification:** focused orbit/parser/reverse-index tests pass; the Thayer/BDB Doctors retain their clean/malformed guarantees, and the MACULA semantic-sense Doctor reports 126,198 tagged tokens, 7,049 ids / 9,100 lemma keys, zero exact-key conflicts, and clean labels. The current suite passes 317 tests with 10 expected Electron-ABI skips (327 total); `npm run lint`, `npm run verify:data`, Electron build, renderer build, and Electron native preflight pass. Browser interaction checks cover both language shapes plus six Greek data classes: Luke 4:14 `πνεῦμα`, `περί`, and `αὐτός`; Romans 1:5 `λαμβάνω`; Matthew 3:2 `λέγω`; and Matthew 1:2 `δέ`. Their light/dark tours show concise source labels, selected-occurrence state, visible caps, full-label expansion, and no Thayer scaffolding; captures live under `docs/ui-audit/screens/`.

## Progress — 2026-07-09 (highlight interaction + blob aesthetic hardening)

The highlight system received a full behavioral and visual pass, with live Electron QA against a disposable copy of `Library-demo`:

- **Continuous range model:** native text drags may begin and end in different verses. The first/last verse retain exact character endpoints; intervening verses are fully covered. Shift-click creates a contiguous range from a stable anchor, while Command/Control-click can no longer imply a discontiguous range that persistence would silently fill.
- **Precise replacement/removal:** overlap handling now subtracts ranges instead of deleting an entire multi-verse record. Applying a new color to the middle preserves both outer pieces. “Remove Selection” subtracts only selected characters; “Remove Highlight” deletes the complete connected same-color blob.
- **Transactional Undo:** create, range erase, grouped recolor, and grouped delete retain exact before/after snapshots. Undo validates the current after-state before restoring, so a stale toast cannot overwrite later edits. Restores remain append-only events and SQLite stays a materialized view (INV-7/INV-9).
- **Unified margin behavior:** word highlighting remains available while Living Margin is open. Margin recolor/remove acts on all records in the pinned blob, not an arbitrary first match. Mixed-color selections have an explicit neutral selection state and all swatches/buttons have accessible names.
- **Blob rendering:** highlights are rendered from measured text-line rects: tight text rag, broad 5px exterior caps, compact 1.5px easing only at internal width steps, no full-column field extension, and duplicate rect coalescing. Visual QA rejected both the original 5px internal fillets (corner nubs) and a broad S-curve experiment (ribbon-like scoops); the final restrained step follows the text without advertising its geometry. Same-color records form one silhouette. Adjacent colors tessellate without gaps or overlap with only a 0.3px shared lean. The reading wash has no uniform outline—the gradient defines its edge—so dense color changes do not resemble a segmented control. Light/dark tokens were tuned independently.
- **Translation/version safety:** highlight records are package-specific because character offsets in WEB cannot be projected onto KJV wording. The chapter query may return both packages, but the renderer, selection model, ambient annotation detection, and Living Margin receive only the active package. Switching versions clears the old text/selection in the same commit and swaps to that version's highlight layer; pinned passage-insight caches also include the package. Notes, anchors, and cross-references remain shared because their coordinates are canonical. Whole-verse highlights remain package-specific for one coherent mutation model; any future cross-version carryover should be an explicit canonical verse annotation, never an implicit offset remap.
- **Dark yellow aesthetic:** the dark-theme yellow family is now a lower-chroma antique gold (`211 178 105`) with reduced alpha, rather than the brighter light-theme ochre. The reading wash and selected-verse marker stay muted alongside blue/green/pink/purple, while compact palette/margin controls retain a quiet gold identity.

**Verification:** focused range/adjacency/path/selection/margin/package tests pass; repository suite excluding the independently broken embedding-worker test file is green with only Electron-ABI skips; typechecks, Electron build, renderer build, lint, and `git diff --check` pass. End-to-end CDP QA passed cross-verse drag persistence, middle replacement, phrase split, precise erase, grouped recolor/delete, exact Undo, selection modifiers, margin-open palette, accessible swatches, and WEB→KJV→WEB text/highlight isolation with selection reset. Visual QA covers the primary dense fixture in light/dark, an adversarial fixture with short phrases, three same-line colors, adjacent same-color records, a partial three-verse span, and stacked colors in light/dark, plus a 900px narrow reflow with the margin hidden. Captures live in `output/playwright/highlights*.png`. The unmodified `tests/worker-embeddings.test.ts` currently cancels all five tests because its first promise remains pending after the event loop resolves; this is outside the highlight path.

## Progress — 2026-07-01 (margin-toggle relocation)

Real usability bug reported directly against the running app: the "Hide/Show Margin" button, living in the sidebar footer (`.sidebar-footer-controls`), was unclickable — hidden behind the main reading area. Root cause: the sidebar is a fixed-height `flex-direction: column` stack (brand row, nav, a flex spacer, footer-controls, footer avatar row) with `overflow: hidden` (added earlier this session to fix a separate collapse-width bug); when the stack's total content height exceeds the available vertical space, the footer-controls row gets clipped away (or, pre-`overflow:hidden`, spills out and gets painted over by the later `.main-content` sibling) — either way, unreachable.

**Design call:** relocate, not patch. The original design handoff already specified the correct home for this control — the 56px topbar, right-aligned as an icon button next to the theme toggle — a single-row flex container with no vertical-overflow risk at all. Moved it there, mirroring the existing `onToggleTheme`/theme lift-to-App pattern exactly (`onToggleMargin` prop, same convention). Removed the old `.sidebar-footer-controls` block and its now-dead CSS. `toggleMargin`'s function body, persistence, and `userDirtySettings` dirty-tracking were left completely untouched — only its call site moved. Adversarially reviewed; only finding was a stale doc reference (this file), corrected.

**Verification:** `npm run typecheck` (clean), `npm run typecheck:renderer` (clean), `npm run build:renderer` (231.7kb JS / 37.9kb CSS), `npm test` — **81/81 passing**, including `tests/app-settings-load-race-contract.test.ts` and `tests/scripture-page-margin-visibility-contract.test.ts` unmodified (both assert on `toggleMargin`'s behavior, not the button's former location).

## Progress — 2026-07-01 (post-redesign live QA + fixes)

Live QA of the read-screen redesign via Chrome DevTools Protocol against the running Electron app, plus a full adversarial code review. Findings and fixes, on top of the Integration phase below:

- **Real bug (critical), fixed:** `sidebarCollapsed`/`marginVisible`/`theme` could silently self-revert within ~100ms-2s of a user toggling them. Root cause: the settings-load effect in `app.tsx` applied its async `window.api.settings.get()` result unconditionally, clobbering a user's toggle if it landed in the resolution window. Fixed with a `userDirtySettings` ref set synchronously at click time, before `setState`, so the load effect skips any setting the user already touched. Regression test added: `tests/app-settings-load-race-contract.test.ts`.
- **Real bug (major), fixed:** `Popover.tsx` only clamped the panel's top edge against the viewport bottom using the anchor position, never the panel's own rendered height — a popover opened from a low anchor could overflow off-screen uncorrected. Fixed with a second `useLayoutEffect` pass that measures real panel height and flips above the anchor (or clamps) when it would overflow.
- **Real bug (minor), fixed:** `.app-shell` had no `background`/`color` of its own, so the outer `html`/`body` backdrop (never given the `dark` class) stayed light-themed and could show through at edges. Fixed by painting the theme background directly on `.app-shell`.
- **Real bug (minor), fixed:** toast `.toast-action`/`.toast-close` used hardcoded white-based overlay colors tuned only for a dark toast background; in dark mode the toast itself flips to a light background (by design — it swaps `text-primary`/`bg-surface`), making the close button and Undo pill nearly invisible (~1.12:1 contrast). Fixed with theme-aware `--toast-overlay-bg`/`--toast-fg-subtle` tokens, dark-mode overridden.
- **Real bug (minor), fixed:** a stale-selection bug — navigating chapters (passage jump, nav arrows, ⌘←/→) while the highlight palette was still open left the old chapter's `selectedVerses` intact, so a color pick after navigating could write a highlight to the *new* chapter using the *old* chapter's verse numbers. Fixed by clearing `selectedVerses`/closing the palette in the existing chapter-change reset effect.
- **Minor consistency fix:** one early-return branch in the semantic-margin effect didn't return a cleanup function like its siblings — benign today, but a latent trap for a future edit. Fixed for consistency.
- **Live-confirmed working correctly (CDP-driven, real interactions, not just static review):** sidebar brand-row library popover (open/Escape/scrim-close), passage picker (chapter grid navigation, book search with testament-grouped filtering, back-and-forth view switching), version picker (WEB/KJV switch actually re-fetches text), theme toggle (dark CSS variables correctly resolve on `.app-shell`), Living Margin's Chapter Overview state (real stats, no fabricated summary prose) and Selected Passage state (verse pin, 5-swatch palette, real highlight creation via the same IPC path, gradient wash renders with correct color-specific gradient stops), the floating in-text palette fallback when the margin is hidden, and regressions: passage-jump text input, the ⌘←/→ keyboard-nav input-focus guard, and the effect-based chapter-cancellation guard all still work.
- **Known non-issue (documented, not fixed):** live testing of the sidebar collapse width transition was inconclusive — the Electron window ran in a backgrounded/non-visible state in this environment (`document.hidden: true`, confirmed even a forced inline `!important` style didn't immediately relayout, consistent with Chromium's documented throttling of paint/transitions for hidden pages), which also explains a couple of `requestAnimationFrame`-dependent test hangs during this session. This is very likely a test-harness artifact, not a real functional bug, but could not be 100% confirmed against a genuinely focused/visible window from this session. Recommend a manual visual check of the collapse animation. Kept a valid, harmless hardening regardless: added `min-width: 0` and `overflow: hidden` to `.sidebar` (flex items default to `min-width: auto`, which floors shrinking at content size — good practice for any collapsing flex rail even though it wasn't confirmed to be the actual blocker here).
- **Verification:** `npm run typecheck` (clean), `npm run typecheck:renderer` (clean), `npm run build:renderer` (231.5kb JS / 38.0kb CSS), `npm test` — **81/81 passing**.

## Progress — 2026-07-01 (redesign integration)

Integration phase closing out the 4-phase redesign (Foundation → Sidebar → Topbar+Reading → Living Margin → this phase). High-level summary of the full redesign as it now stands, end to end:

- **Sidebar:** collapsible via `sidebarCollapsed` (persisted through `window.api.settings`), a library popover anchored off the brand row (`Popover` primitive), primary nav, and a footer with an AI-busy indicator (`onAiBusyChange` from `ScripturePage`'s `semanticLoading` effect) plus a margin-visibility toggle in a dedicated `.sidebar-footer-controls` row.
- **Topbar + reading column:** passage-picker and version-picker popovers (both built on the shared `Popover` primitive), a redesigned verse renderer with gradient-wash highlight classes (`hl-{color}` on `.verse-line`/`.verse-text-span`, with `cont-above`/`cont-below` continuation classes for adjacent same-color highlights), the passage-jump box (`parsePassage` + atomic `goTo`), and a derived `pinnedRange` (`{start, end}` from `selectedVerses`) surfaced via `onPinnedRangeChange`.
- **Living Margin:** a 3-state panel (`Chapter Overview` default / `Currently Reading` ambient / `Selected Passage` pinned), the ambient state driven by an `IntersectionObserver`-derived `nearVerse` (first annotated verse — real highlight, note, or cross-ref — scrolled into view), and the pinned state exposing the actual highlight color-assignment swatches (`onSetHighlightColor` / `onRemoveHighlight`) plus a session-only cached AI insight for the pinned range.
- **Dark mode + accent color (this phase):** `App.tsx` now owns `theme` state (`"light" | "dark"`), initialized from `window.api.settings.get()` on mount, applies `app-shell dark` vs `app-shell` on the top-level shell div (covering the loading/error/loaded render paths), and passes `theme` + `onToggleTheme` (flips state, persists via `settings.set`) down into `ScripturePage`, which renders the sun/moon toggle button in the topbar. Added a minimal 3-swatch accent picker (blue/green/plum) to `SettingsPage.tsx` under a new "Appearance" section (`.accent-swatch-row` / `.accent-swatch-{color}` classes, no inline styles — keeps `settings-page-style-contract.test.ts` green) that calls `window.api.settings.set({ accentColor })` and updates `--accent-current` on `document.documentElement` immediately; `App.tsx` also applies the persisted `accentColor` to `--accent-current` on initial load so a relaunch reflects the saved choice before Settings is ever opened.
- **End-to-end prop audit:** verified every prop between `App` → `ScripturePage` → `LivingMargin` connects with no dangling/unused names — `marginVisible`, `onAiBusyChange`, `theme`, `onToggleTheme`, `pinnedRange`/`onPinnedRangeChange`, `nearVerse`, `onSetHighlightColor`/`onRemoveHighlight` (formerly a bare `onDeleteHighlight`, now also wired for create via `onSetHighlightColor`). Confirmed the floating in-text highlight palette in `ScripturePage` is still gated on `!marginVisible`, and that both it and the Living Margin's pinned-state palette call the same `handleHighlight`/`handleDeleteHighlight` closures underneath, which hit the same `window.api.library.createHighlight` / `deleteHighlight` IPC — i.e. highlighting works identically through either UI depending on whether the margin is shown.
- **Persistence:** `sidebarCollapsed`, `marginVisible`, `theme`, and `accentColor` all round-trip through `window.api.settings.get()`/`set()` (electron-store backed); confirmed by code-path inspection (no live Electron launch per ABI constraints) that a reload re-reads `settings.get()` in `App`'s init effect before any user interaction can diverge from the persisted value.

**Verification:** `npm run typecheck` (clean), `npm run typecheck:renderer` (clean), `npm run build:renderer` (231.0kb JS / 37.7kb CSS, no errors), `npm test` — **80/80 passing**, including all 9 protected contract tests named in this phase's constraints.

**Left incomplete / deferred (explicit):**
- No new automated DOM-level test was added specifically for theme toggling or the accent picker (matches the pattern of prior phases, which also relied on source-contract tests + `build:renderer` rather than a jsdom render harness for new UI). `settings-page-style-contract.test.ts` still passes (no inline styles introduced).
- The per-accent **dark-mode variant** mentioned in the Foundation phase's CSS comment (e.g. an `.accent-blue.dark` combination selector for a richer dark+accent interaction) was not built — `--accent-current` just points at the same `--accent-{color}` value regardless of theme, which is visually adequate (the accent is used sparingly as an outline/active color) but not a custom-tuned dark variant per accent.
- The Living Margin's AI-insight cache remains session-only and is discarded when the margin is hidden/shown or the app reloads (carried over from the Living Margin phase's own stated scope — not something this integration phase was asked to change).
- Real end-to-end manual verification (launching Electron, clicking through theme toggle / accent picker / highlight creation in both margin states) was **not** performed, per the hard ABI-safety constraint against running `npm start`/rebuild/preflight scripts in this phase. Verification here is limited to typecheck/build/test plus direct source reading of the wiring.

## Progress — 2026-06-30

- Live Electron QA with DevTools + screen state found no margin-toggle leak: 30 rapid hide/show cycles completed with max 10 ms visible toggle latency and p95 4 ms; DOM nodes returned to baseline after the loop and GC.
- Current highlight persistence path is incremental, not full-rebuild: direct `createHighlight` IPC measured about 2 ms and `queryRange` stayed under 5 ms on the active library.
- Highlight palette now dismisses immediately after the optimistic visual update, before waiting for disk/Git persistence, so a slow save cannot keep the user in a spinner state.
- Verse highlight classes now refresh on chapter changes even when the Living Margin is hidden; cross-refs and semantic margin work remain gated until the margin is visible.
- Added `tests/scripture-page-highlight-optimistic-contract.test.ts` to guard the palette-before-persistence ordering.
- Navigation §8: added a **passage-jump control** ("Go to… e.g. Rev 14"). Parses `Rev 14` / `Revelation 14` / `1 Cor 13` / `Psalm 119` / `John 3:16` / bare book via a renderer-local pure util `src/renderer/utils/parsePassage.ts` (renderer stays self-contained — no `src/core` import; reuses the existing alias data). Submitting calls an atomic `goTo(book, chapter)` so book+chapter change in one render → one `getChapterText` fetch, eliminating the intermediate chapter-1 load on long-distance jumps.
- Added **request sequencing/cancellation** to the chapter-text load effect (`cancelled`-closure, mirroring the margin effect) so a slow/cold `getChapterText` (e.g. a ~735 ms Psalm 119 range) resolving out of order can no longer overwrite a newer chapter. The chapter-error **Retry** now routes through the same guarded effect via a `retryToken` instead of an unguarded inline fetch.
- Added tests: `tests/reference-passage-jump.test.ts` (13 behavioral cases for `parsePassage`, incl. alias-length precedence and out-of-range chapter/verse), plus source-contract tests `tests/scripture-page-chapter-cancellation-contract.test.ts` and `tests/scripture-page-passage-jump-contract.test.ts`. Full suite 42/42; typecheck, typecheck:renderer, build:renderer all pass.

## Findings — Current State Audit

### 1. Highlight System (L2 — functional, needs safety polish)

**1a. Performance: incremental path is in place.**
`create-highlight` now uses `engine.applyHighlightCreate()` and incremental SQLite insert/delete paths instead of `engine.buildSqlite()`. Live Electron QA on the active library measured direct highlight creation at about 2 ms and chapter `queryRange` under 5 ms. The remaining UX guard is to keep visible feedback optimistic so slower future libraries cannot hold the palette open.

**1b. Replace-on-overlap exists.**
Before creating a new highlight, the IPC handler queries existing active highlights for the same book/chapter/package and emits delete events for overlapping highlights before appending the new create event.

**1c. Delete UI exists; undo remains shallow.**
The Living Margin exposes highlight delete buttons and the palette exposes remove when an already-highlighted verse is selected. Toast undo for created highlights calls delete, but delete undo is only messaging today; proper restore semantics still need a product decision.

**1d. Palette positioning (fixed in this session).**
Was `position: absolute` relative to the centered `.verse-text` container, calculated against the full-width scroll container — causing the palette to drift past the Living Margin on wide windows. Fixed to `position: fixed` with viewport coordinates.

**1e. Creation feedback is optimistic.**
The verse background updates before persistence, the palette dismisses immediately, and a toast confirms success or failure. Failure reloads margin data to revert the optimistic row.

### 2. Onboarding / Library Picker (L0 — none)

**2a. Silent library creation.**
`initializeEngine()` silently creates a library at `~/Documents/ScriptureLibrary` if none exists. No first-run flow, no welcome screen, no library location picker. The user has no idea where their data lives or that a library was created.

**2b. No library path display.**
The app never shows the user where their library is. No settings panel, no about dialog, no status bar. If the user wants to find their library folder, they have to know to look in `~/Documents/ScriptureLibrary`.

**2c. No library switching.**
The `init-library` IPC handler exists and can initialize a library at any path, but the renderer never calls it. There is no UI to open or switch libraries.

### 3. Loading / Error States (L0-L1 — thin)

**3a. "Loading library..." hangs forever on IPC failure.**
`App.tsx` shows "Loading library..." until `getBackbone()` and `getBookNames()` resolve. If either IPC call rejects (e.g., backbone validation fails, file missing), the promise rejects silently — no catch handler, no error UI, no retry. The user sees "Loading library..." forever.

**3b. No error boundaries.**
No React error boundary. If any component throws during render, the entire app goes blank with no message.

**3c. Scripture text loading has no error state.**
`getChapterText()` returns `null` on failure, and the UI shows "Loading text..." indefinitely. No error message, no retry.

**3d. Semantic margin blocks margin rendering.**
`loadMarginData()` awaits the semantic margin call before setting any margin data. If the semantic call is slow (it computes deterministic embeddings over all stored embeddings), the entire margin panel stays empty. The deterministic margin (notes, highlights, cross-refs) should render first, then semantic data loads async.

**3e. Cross-refs are sequential.**
7 sequential `getCrossRefs` IPC calls (one per verse) instead of a single batched call. Each IPC round-trip is ~1-5ms, but they're awaited in `Promise.all` which is at least parallel — still 7 separate calls.

### 4. Settings (L1 — minimal)

**4a. BudgetSettings is the only settings view.**
It shows AI budget envelope, network toggle, token ceiling, usage bar, and recent AI jobs. No library path, no package selection, no about/version info, no theme settings, no scripture package management.

**4b. No package management.**
The app hardcodes WEB and KJV. No UI to see installed packages, their licenses, or their format versions. The Doctor checks package format versions and content coverage (B1), but the user never sees this.

**4c. Inline styles everywhere.**
BudgetSettings uses inline styles throughout (200 lines of `style={{...}}`). No CSS classes. Inconsistent with the rest of the app which uses design tokens via CSS classes.

### 5. Source / Import (L1 — minimal)

**5a. ImportPage only handles Obsidian vaults.**
One button: "Choose Vault Folder". No PDF import UI (the backend exists in `pdf-source.ts`). No progress indicator during import. No file preview. No error detail beyond a single error string.

**5b. No source list.**
No UI to see imported sources, their chunks, or their rights/policy (§4.8).

### 6. Sync Status (L0 — none)

**6a. No sync UI at all.**
M6 sync proof exists in the backend (`src/host/sync.ts`), but there is no UI surface. No sync status indicator, no last-synced timestamp, no conflict resolution UI, no device list.

### 7. Design System (L1 — exists but underused)

**7a. Design tokens are well-defined.**
`design-tokens.json` and `:root` CSS custom properties cover colors, typography, spacing, radius, shadows, transitions. The palette is cool-neutral, professional. Source Serif 4 for reading, Inter for UI.

**7b. Inconsistent application.**
- BudgetSettings: 100% inline styles, no classes
- ScripturePage: mix of classes and inline styles
- LivingMargin: mix of classes and inline styles
- No shared component primitives (buttons, inputs, cards)

**7c. No dark mode.**
All tokens are light-only. No `prefers-color-scheme` media query. No theme toggle.

**7d. No responsive behavior.**
Living Margin is always visible at 340px. On narrow windows (< 900px), the reading column gets squeezed. No collapse/toggle for the margin.

### 8. Navigation (L1 — basic)

**8a. No keyboard navigation.**
No arrow keys for chapter navigation. No cmd+arrow for next/previous chapter. No keyboard shortcuts for highlight colors.

**8b. No chapter prev/next buttons.**
The only way to change chapters is the dropdown. No prev/next arrows.

**8c. No book search/filter.**
66 books in a flat dropdown. No search, no grouping by testament, no recently-used.

## Plan — B2 Implementation

### Phase 1: Highlight UX (L0 → L3)

The highlight flow is the most-used interaction and currently the most broken. Fix it first.

**1.1 Incremental SQLite updates for highlights.**
- Add `insertHighlightIncremental(h)` and `deleteHighlightIncremental(entityId)` to `SQLiteMaterializer` — single-row INSERT/DELETE without dropping the DB.
- Add `engine.applyHighlightEvent(event)` and `engine.applyHighlightDelete(entityId)` that write the event to JSONL and update SQLite incrementally.
- Update `create-highlight` and `delete-highlight` IPC handlers to use incremental updates instead of `buildSqlite()`.
- Keep `buildSqlite()` for full rebuilds (INV-9) — it's still the recovery path.

**1.2 Replace-on-overlap.**
- Before creating a new highlight, query existing active highlights for the same book/chapter/package that overlap the new verse range.
- If overlaps found, emit `delete` events for the old highlights (INV-7: append-only, so we delete, not edit) then create the new one.
- This means "re-highlighting" a verse replaces the old color, doesn't stack.

**1.3 Undo via delete + toast.**
- Add a "Remove highlight" button to the palette (trash icon) that appears when clicking an already-highlighted verse.
- Add a toast notification system: "Highlight created" with an "Undo" button that calls `delete-highlight`.
- Toast auto-dismisses after 5s. Undo button calls `delete-highlight` with the entityId from the create response.

**1.4 Visual feedback.**
- Palette buttons show a brief loading state during creation.
- Verse background updates optimistically (before IPC resolves) and reverts on failure.
- Palette dismisses on click-outside or Escape.

**1.5 Highlight list in Living Margin.**
- Existing highlights for the current chapter show in the margin with a delete button (x) on hover.
- Clicking a highlight in the margin scrolls to and selects those verses.

### Phase 2: Loading / Error States (L0 → L2)

**2.1 Error boundary.**
- Add a React error boundary at the App level that catches render errors and shows a recovery screen with "Reload" and "Show error details" buttons.

**2.2 IPC error handling.**
- Wrap all `window.api.*` calls in a shared `safeCall` wrapper that catches rejections and returns `{ ok: false, error }` instead of throwing.
- App.tsx: if `getBackbone()` or `getBookNames()` fails, show an error screen with the error message and a "Retry" button.

**2.3 Non-blocking margin loading.**
- Split `loadMarginData()` into two phases:
  - Phase 1 (fast): query range for notes/highlights + cross-refs → render immediately.
  - Phase 2 (slow): semantic margin → render when ready, show subtle "Loading semantic margin..." placeholder.
- Batch cross-ref calls into a single `getCrossRefsForChapter(book, chapter)` IPC handler instead of 7 sequential calls.

**2.4 Chapter text error state.**
- If `getChapterText()` returns null after 2s, show "Failed to load text for {book} {chapter}" with a retry button.

### Phase 3: Onboarding / Library (L0 → L2)

**3.1 First-run welcome.**
- On first launch (no library manifest found), show a welcome screen:
  - "Welcome to Scripture Library"
  - Brief description (1-2 sentences)
  - "Choose Library Location" button (opens directory picker)
  - "Use Default Location" button (~/Documents/ScriptureLibrary)
  - Shows the chosen path before confirming.

**3.2 Library info in sidebar footer.**
- Show library path at the bottom of the sidebar (truncated with tooltip).
- Click to reveal in Finder.

**3.3 Library switcher.**
- Add "Switch Library" option in settings or sidebar footer.
- Opens directory picker, calls `init-library` with the chosen path, restarts the app.

### Phase 4: Settings (L1 → L2)

**4.1 Unified settings page.**
- Replace BudgetSettings with a proper Settings page with sections:
  - Library: path, switch, rebuild index, storage usage
  - Scripture Packages: installed packages, licenses, format versions
  - AI Budget: existing budget envelope UI (refactored to use CSS classes)
  - About: app version, data versions, links

**4.2 CSS class refactor.**
- Move all inline styles from BudgetSettings into `styles.css` using the design token system.

### Phase 5: Navigation Polish (L1 → L2)

**5.1 Chapter prev/next.**
- Add prev/next arrow buttons in the chapter nav bar.
- Cmd+Left / Cmd+Right keyboard shortcuts.

**5.2 Book dropdown grouping.**
- Group books by testament (Old Testament / New Testament) using `<optgroup>`.
- Add a search/filter input above the dropdown.

**5.3 Living Margin toggle.**
- Add a button to collapse/expand the Living Margin panel.
- Remember preference in localStorage.

### Phase 6: Design System Consolidation (L1 → L2)

**6.1 Shared primitives.**
- Extract reusable Button, Input, Card, Toast components.
- All use design tokens via CSS classes, no inline styles.

**6.2 Consistent focus states.**
- All interactive elements have visible focus rings using `--accent-user`.
- Keyboard navigation works everywhere.

**6.3 Empty states.**
- Every view has a proper empty state with helpful guidance text.
- ScripturePage: "Select a book and chapter to begin reading."
- SearchView: "Type to search your notes."
- Notes: "No notes yet. Create one from the Write tab or by selecting a passage."

### Out of scope for B2

- PDF import UI (source rights UI, B4 territory)
- Sync status UI (C2 territory)
- Plugin management UI (C3 territory)
- Mobile responsive (D1 territory)

## Quality Gate

Before marking B2 complete:

1. **Highlight flow:** Create, replace-on-overlap, undo, delete — all work without full SQLite rebuild. Sub-100ms response time.
2. **Error states:** Every IPC call has a catch handler. Error boundary catches render crashes. No infinite loading states.
3. **Onboarding:** First-run user sees a welcome screen, can choose library location, and knows where their data lives.
4. **Settings:** Library path, packages, AI budget, and about info are all visible. No inline styles.
5. **Navigation:** Prev/next chapters, keyboard shortcuts, book grouping, margin toggle.
6. **Design:** All components use design tokens via CSS classes. Consistent focus states. Proper empty states.
7. **Tests:** New tests for highlight replace-on-overlap, incremental SQLite, error boundary, first-run flow.
8. **Runtime gates:** Lint and both typecheck halves pass. `verify:m2` runs under a matching Node native ABI; Electron preflight/build verifies the shipped Electron ABI without rebuilding the active visual-QA runtime.
9. **Manual verification:** App launches, scripture renders, highlights work smoothly, settings display correctly.
