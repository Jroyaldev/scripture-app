# B2 — App UX Pass

> **Status:** In progress. Target: L0-L1 → L2-L3.
> **Predecessors:** A0 (snapshot), A1 (native build), B1 (scripture data).
> **Contracts:** §4.2 (event fold), §4.4 (SQLite materialized view), §4.6 (note format), INV-7 (append-only), INV-9 (safe to rebuild).

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

- Dark mode (design system expansion, separate task)
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
8. **Lint + typecheck + verify:m2:** All pass.
9. **Manual verification:** App launches, scripture renders, highlights work smoothly, settings display correctly.
