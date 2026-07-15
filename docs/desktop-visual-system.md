# Scripture Desktop Visual System

This document is the living visual contract for the desktop app. It does not replace the frozen product specification or alter data, authorship, or trust invariants.

## Direction

Scripture should feel calmer than Logos, simpler than a general-purpose research suite, and more study-specific than Shepherdly. The interface is not a dashboard wrapped around a Bible. It is a quiet reading desk whose tools appear at the moment they become useful.

The system borrows Shepherdly's strongest discipline—warm material, sparse elevation, and restrained gold—but adapts it to continuous reading, original-language study, and source-backed diagrams.

## Visual laws

1. **Gold is a verb.** Gold means current, actionable, focused, or selected. It is not decoration and never substitutes for a data category.
2. **Data keeps its color.** Highlights, syntax roles, and measured chart series may use semantic hues. Chrome, navigation, and generic cards do not.
3. **Material may change; meaning may not.** Every atmosphere shares geometry, hierarchy, copy, and interaction. Only light, depth, and surface opacity change.
4. **Typography carries hierarchy.** Source Serif is for Scripture, original-language content, and meaningful display text. Inter is for controls and explanations. JetBrains Mono is for compact provenance, coordinates, counts, and telemetry.
5. **One geometry register.** Controls use 6px corners, panels 12px, and large cards/dialogs 20px. Pills remain fully rounded only when their shape communicates a compact state.
6. **Elevation is scarce.** Most relationships use spacing, a material shift, or one hairline. Shadows are reserved for floating layers and deliberate focus.
7. **Motion explains.** The default transition is 150ms. Motion may reveal origin, continuity, or state change; it does not decorate idle surfaces.
8. **Refuse visual falsehood.** A beautiful diagram, label, or color must still reflect the underlying source and measurement. Existing language and Structure truth contracts remain authoritative.

## Reading atmospheres

| Stored id | Name | Promise |
|---|---|---|
| `light` | Paper | Warm, quiet, and effortless to read. |
| `dark` | Ink | Low-glare focus for long study. |
| `glass` | Glass | Soft daylight with translucent depth. |
| `dark-glass` | Candlelight | Warm dark glass with a gentle glow. |

The picker is named **Reading atmosphere**, not Theme. Its compact explanation is **Material changes. Meaning does not.** The two glass images are suite-owned assets copied from the sibling Shepherdly project (`public/dashboard/glass-light.png` and `glass-dark.png`); no external image dependency is introduced.

## Surface hierarchy

- **Shell:** background atmosphere and application boundary.
- **Reading sheet:** the highest-legibility continuous surface for Scripture and long-form controls.
- **Sidebar / Living Margin:** quieter adjacent materials separated by one hairline.
- **Inset:** grouped controls and local selected states.
- **Float:** popovers, menus, transient palettes, and dialogs. Floating content is intentionally more opaque than glass canvases.

## Sidebar contract

- Expanded width is 228px; the optional collapsed rail is 64px. These are the production densities, not user-selectable visual experiments.
- The Scripture wordmark identifies the application and does not open a library menu. The footer switcher is the single place that identifies and changes the active local library.
- The sidebar toggle belongs inside the brand header rather than straddling the content divider. In the collapsed rail the brand remains visible at rest and yields to the expand action on header hover or keyboard focus, keeping identity and navigation ownership in one stable location.
- The active destination combines a neutral inset material with one gold icon. Hover is a quieter material change. Keyboard focus keeps the visible gold ring.
- Numeric shortcuts remain `1–5`, but their labels appear only on the hovered or keyboard-focused destination so the idle column stays quiet.
- The idle footer says `Local library`. It never implies cloud sync. While source-backed passage work is active it says `Studying passage…` and pulses the avatar.

## Reading topbar contract

- The bar has two stable zones: passage location and movement on the left; reading tools on the right. Living Margin visibility never changes either zone's position.
- Book/chapter, Previous/Next, translation, and passage jump form one compact navigation system. `⌘K` focuses the jump command; Escape clears an error or returns focus from a picker.
- Picker headings explain the consequence of the choice. Translation changes rendered text while notes stay anchored; Reading layout changes presentation while preserving text.
- Icon-only reading tools retain visible hover/focus states, truthful accessible names, and one quiet divider between presentation controls and panel/atmosphere controls.
- Reading layout uses one typography-and-measure glyph. It does not append the current size as a detached letter; the popover carries the complete size, width, and verse-number state.
- Desktop compression preserves every capability. At 900px the dormant jump command becomes an icon and expands on focus without colliding with the passage group.

## Reading canvas contract

- A chapter is one semantic article with a real heading and one continuous reading measure. It is not a stack of cards, and note-derived theme labels do not sit inside canonical Scripture.
- Verse rows use a stable number gutter and a text column. The number remains quiet; Source Serif and whitespace carry the reading rhythm.
- Hover is a faint material wash. Verse focus uses a short gold rail instead of a perimeter around the text. Existing highlight colors remain the semantic layer and are never replaced by generic selection chrome.
- Arrow Up/Down, Home/End, and Enter/Space form a complete spatial keyboard path through the chapter. A chapter change returns the reader to the top; an explicit bottom continuation focuses the next chapter landmark.
- Loading, error, and empty are designed states with an announced status, a useful recovery action, and technical detail kept subordinate.
- The reading measure remains usable at the 900px desktop floor. Focus mode and Living Margin visibility may change available space without changing the chapter's semantics.

## Living Margin contract

- The panel is one labelled `Study` frame with a persistent header and three truthful modes: `Chapter` at the top, `In view` while reading, and `Selected` after an explicit verse or range choice.
- Chapter overview is contextual, not a generic empty card. It may summarize real highlights, notes, connections, and note-derived themes, then offers one concise next step.
- Scrolling Scripture releases an old language-study lock and follows the reading eye-line. Pointer use inside the margin pauses that movement without allowing a stale hover flag to freeze the panel afterward.
- Selected context keeps the passage reference and a bounded quotation first. Long ranges disclose the complete quotation on request. `Done` clears selection and returns focus to the persistent heading.
- Language remains the primary study surface. OpenBible connections, local notes, passage insight, related notes, themes, grounded claims, and note-derived connections appear only when real data exists and keep their distinct source/scope labels.
- Passage-scoped semantic content never falls back to a chapter-wide result. Secondary local-library material collapses under one disclosure so evidence remains available without dominating the daily reading path.
- Note previews are plain readable articles unless they have a real action. Counts are tabular and subordinate; hairlines and spacing create hierarchy instead of colored borders, card shadows, or permanent category chrome.

## Shared controls and floating layers contract

- Buttons share one 32px/36px geometry and four explicit intents: primary, secondary, ghost, and danger. Hover changes material, press compresses gently, busy keeps the label legible, and disabled never masquerades as an available action.
- Text fields and text areas use the same warm inset, 6px control radius, invalid/disabled states, and one soft gold focus halo. Cards remain 12px quiet surfaces; menu rows use material selection rather than lift or decorative color.
- Segmented controls are real single-tab-stop radio groups. Arrow keys change adjacent choices, Home/End reach the boundaries, and selection combines a raised material with one restrained gold underline.
- Anchored popovers are lightweight by default: the outside-click layer is transparent, the surface is named and initially focused, Escape closes, callers restore focus, and resize refuses stale positioning. Dimming and focus containment are explicit modal options rather than the cost of every small picker.
- Compact icon actions use real delayed tooltips, available on hover and keyboard focus with optional shortcut text. Native `title` bubbles are no longer the only affordance for the primary reading controls.
- Toasts are typed neutral/success/warning/error status surfaces with correct live-region behavior, a dismiss label, optional action, bounded timer, exit motion, and a quiet progress line. They inherit the active reading material even though they sit outside the shell layout.
- Modal note capture contains focus, restores it to the real invoking control or its Scripture fallback, and uses the shared fields/actions. Specialized study meaning and visualizers remain untouched until the dedicated overlay pass.

## Settings, onboarding, and import contract

- Settings is one titled local-library workspace with a stable five-section rail: Library, Reading, Intelligence, Import, and About. The current section follows scroll position, and the rail compacts without clipping content at the supported 900px desktop floor.
- Library identity and counts come from the active library. Installed reading texts expose their real names and license posture; disclosure stays adjacent rather than hiding provenance behind a generic package count.
- Library switching, index rebuilds, and network-backed assistance are explicit user actions. Busy, success, failure, retry, and cancellation-safe states use the shared status language instead of native alerts or silent mutation.
- Reading atmosphere, text size, measure, and verse-number controls reuse the shared keyboard-complete choice system. Material changes never alter Scripture, coordinates, or authored data.
- Intelligence settings say when network use is allowed, distinguish the active mode from its daily limit, and save editable limits deliberately instead of persisting on every keystroke.
- Import is a staged flow: choose a source vault, review what will happen, then explicitly import. The source remains unchanged; progress, completion, transport failure, importer failure, retry, and start-over states are all visible.
- First run leads with ownership: plain files, local by default, and one movable folder. The recommended location is presented before creation, and a custom location is shown for confirmation before the library is initialized.
- `qa:setup` exercises every Settings section in Paper, Ink, Glass, and Candlelight, keyboard choice behavior, the 900px desktop floor, and an isolated temporary first-run profile without mutating the active library.

## Write, Notes, and Search contract

- Write is a deliberate local authoring surface, not an autosaving cloud editor. The note remains an in-memory draft while the reader moves through Scripture, Notes, and Search; only the explicit Save note action writes Substrate.
- A failed save never clears the draft. Busy, error, and success states use shared status and toast language, while `Command-S` invokes the same explicit save path as the visible action.
- The writing sheet keeps title, body, word/character measure, local/plain-Markdown trust, and source-suggestion feedback in one restrained hierarchy. Background enrichment may offer Scripture anchors after save, but every anchor remains an explicit user choice.
- Notes is a real notebook workspace: a recent-first, locally filterable list opens a shared reading detail with legible Markdown structure, tags, dates, word count, and each parsed Scripture reference as an explicit return-to-reading action.
- Search uses the library's full-text index without exposing implementation jargon. Requests are debounced and sequence-guarded so a slower earlier result cannot replace a later query; recent notes, loading, no-match, transport error, retry, and clear states are all designed.
- Note-list rows form one spatial keyboard path with Arrow Up/Down and Home/End. Selection remains visible and the same note detail is used by library browsing and search, so retrieval does not become a second navigation model.
- `qa:notebook` proves that a populated draft survives navigation, keyboard selection moves the active note, real full-text results open the matching detail, all four atmospheres remain coherent, the 900px desktop floor does not overflow, and authored-note count is unchanged before and after the tour.

## Study overlays contract

- The original-language strip is source text rather than a chip tray. One selected word uses the shared restrained material and gold-current mark; definitions, word maps, grammar, Structure, usage, and provenance remain progressively disclosed beneath it.
- In English and Behind this word remain quantitative rings because their segments represent real corpus counts. Senses remains a hierarchy outline. The three word-map modes form one roving tab path with Arrow keys and Home/End, one selected tab, and one labelled tabpanel.
- Structure is the full-workspace drill-down for the proven Clause, Sentence map, Diagram, and Outline models. Its body portal mirrors the exact Paper, Ink, Glass, or Candlelight material; loading, unavailable data, source sentence, focus containment, recovery, and MACULA/Clear Bible attribution stay explicit.
- The floating highlight palette is one precise anchored tool with five labelled colors and Add note. It portals above filtered glass layers so visual position and pointer hit-testing remain identical in all atmospheres; no swatch acts without an explicit user click.
- Passage note capture is the compact sibling of Write: reference and quotation are carried in, the user's note body remains empty, Plain Markdown/local-only trust is visible, and only Save note or `Command-S` writes Substrate.
- OpenBible rows are quiet clickable previews with destination ranges preserved. `OpenBible · For this verse/Across this passage` stays adjacent to the heading, complete CC-BY attribution stays visible, and personalized note-derived connections remain a separate section.
- `qa:study-overlays` exercises the highlight toolbar, note capture, Greek semantic senses, Structure, and OpenBible previews in all four atmospheres; proves roving-tab focus, exact portal material, 900×700 containment, and unchanged note/highlight counts; and settles only finite CSS animations so remote hidden-window captures remain deterministic.

## Consolidation contract

- `design-tokens.json` and the rendered CSS describe one system: the same Paper/Ink values, 6/12/20px geometry, scarce elevation, desktop dimensions, motion, and four atmosphere assets. It is a durable contract rather than an abandoned prototype palette.
- Generic chrome uses named surface, scrim, shadow, radius, and on-accent tokens. Component inline styles are reserved for runtime geometry, position, duration, direction, or data visualization values; native renderer alerts and hard-coded SVG chrome colors are prohibited.
- Explicit host mutations show busy and recoverable failure states, prevent duplicate submission, and communicate success only after a confirmed result. A failed claim or library action never presents a false saved state.
- `npm run qa:desktop` is the whole-desktop visual regression gate. It runs the Sidebar, Topbar, Reading canvas, Living Margin, Shared controls, Setup, Notebook, and Study overlays tours sequentially across Paper, Ink, Glass, and Candlelight while preserving authored note/highlight counts.

## Interaction language

- Hover changes surface or text tone without lifting the entire component.
- Focus uses one visible gold indicator—usually a ring, or a contextual rail in continuous reading—and never depends on color alone.
- Selected state combines a material change with a restrained gold mark.
- Disabled state reduces emphasis without making essential text illegible.
- Empty states say what is absent and give the next useful action.
- Keyboard behavior and focus return are part of polish, not later accessibility cleanup.

## Component refinement sequence

Each item is a separate bounded B2 pass with before/after desktop captures in all four atmospheres. No mobile-specific work belongs in this worktree.

1. **Global shell and atmosphere system — landed.** Tokens, Paper/Ink/Glass/Candlelight, picker, portal-safe floating layers, Settings gallery, and automated all-look QA.
2. **Sidebar and primary navigation — landed.** One 228px/64px density, static product identity, single footer library switcher, quiet current/hover/focus states, contextual shortcut hints, truthful local/busy status, and repeatable all-look interaction QA.
3. **Reading topbar — landed.** Stable location/tool zones, compact passage/version movement, discoverable `⌘K` jump, named focus-restoring pickers, truthful reading controls, margin-independent geometry, 900px desktop compaction, and repeatable all-look QA.
4. **Reading canvas — landed.** Semantic chapter article, responsive reading measure, quiet number gutter, material hover, rail-only verse focus, highlight-safe range selection, deliberate loading/error/empty states, chapter continuation, 900px desktop safety, and repeatable all-look QA.
5. **Living Margin frame — landed.** Persistent three-mode study frame, real chapter overview, reading eye-line context, finishable selected state, bounded passage quote, progressive local-library disclosure, passage-scoped semantic truth, distinct provenance, focus recovery, and repeatable all-look QA.
6. **Shared controls and floating layers — landed.** Unified button/input/card/menu geometry and states, keyboard-complete segmented controls, lightweight named popovers, delayed accessible tooltips, typed live-region toasts, modal focus containment/recovery, and repeatable all-look QA.
7. **Settings, onboarding, and import — landed.** One five-section local-library workspace, truthful package/licensing and network disclosures, deliberate mutations, ownership-first setup, staged non-destructive import, complete recovery states, 900px desktop compaction, and isolated four-atmosphere QA.
8. **Write, Notes, and Search — landed.** Explicit draft-preserving authoring, recoverable save feedback, a recent/filterable notebook with shared detail, sequence-safe full-text retrieval, Scripture return paths, complete list keyboard flow, and non-mutating four-atmosphere QA.
9. **Study overlays — landed.** Restrained source-text selection, keyboard-complete word maps, exact-material Structure, portal-safe highlight tools, trust-forward passage capture, visible OpenBible provenance, 900px desktop safety, and non-mutating four-atmosphere QA without changing language, syntax, or relationship truth.
10. **Consolidation — landed.** Durable tokens reconciled with the renderer, accidental literals/static inline styles removed, explicit mutation feedback hardened, and all eight four-atmosphere interaction suites unified under `qa:desktop`.

## Quality gate for every pass

- The component is visually inspected in Paper, Ink, Glass, and Candlelight.
- Hover, pressed, selected, disabled, loading, empty, error, and keyboard-focus states are checked when applicable.
- No visual change alters data semantics or trust boundaries.
- Existing screenshots and automation are updated rather than replaced with one-off manual claims.
- Renderer typecheck, relevant focused tests, full tests in proportion to risk, and `git diff --check` pass.
