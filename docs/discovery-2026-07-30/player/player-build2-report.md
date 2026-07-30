# Player Build 2 report (the app's object) — commit ff91d04 on codex/quire-redesign, 2026-07-30

## The surface
Dock painted from --bg-float (the app's floating paper) in all four atmospheres, app ink, app hairline, the app's one elevated shadow. --resource-source no longer touches .podcast-dock. The publisher survives as a PLATE: a 26px rounded rectangle at the mast head, filled in their own colour, carrying their approved mark or their name in --resource-ink. Permission-driven: all six in-repo marks are approved reverses (white artwork for a dark field); masking them to app ink is the modification the grants forbid, so the brand ground survives only at colophon size.

## Accent derivation (canon-recorded)
One input per publisher: --resource-accent (name existed with zero consumers; job restated).
--player-accent = oklch(from var(--resource-accent) clamp(var(--accent-fit-floor), l, var(--accent-fit-ceiling)) c h); light atmospheres clamp l to <= 0.52, dark to >= 0.74, so paper (--bg-float) is ALWAYS the correct ink on it (--player-accent-ink: var(--bg-float)). Consumed in exactly three places: play pill, rail fill, search mark. Default palette fixed the same way (fallback pill ink = the theme's paper) — kills the white-on-white play button by construction. Re-picked accents: enter-the-bible -> #fa4616, naked-bible -> #d9a441. Contrast measured in the running engine through a canvas across 12 palettes x 4 atmospheres: worst 4.91:1 (floor 4.5). Per-atmosphere worst: light 4.91, dark 5.91, porcelain 5.08, onyx 5.84.

## Sheet geometry — overlay, reservation made once
--podcast-dock-h publishes the COLLAPSED height and holds it while the sheet is open; the sheet opens upward OVER the study panel. Asserted: opening changes neither reservation, panel margin, nor toast lane (before 143 / open 629 / reserved 143). Guard reads expandedRef, not sheet height. Caps: dock at 100vh − --frame-top − 2×--page-inset; sheet inner at min(56vh, 520px) with its own scroll. Refs list and chapters became content in that scroll; the transcript keeps its own box (a window onto a moving voice needs a fixed viewport). Three scrollers/masks down to two/one.

## Canon amendments (dated)
- Transport tier: --ease-transport + --transport-quick 140 (play/pause, rail catch-up), --transport-move 240 (sheet, dock, new episode), --transport-voice 460 (depth ramp). Replaces five bespoke curves / eight durations. Loop durations excluded.
- --focus-ring/-width/-offset now real (the seal), consumed here and at the former accidental sites.
- --accent-fit-floor/-ceiling recorded with the measured floor and the tour that holds it.
- --surface-page phantom resolved by naming intent per site (imprint ring ground = --bg-reading; default pill ink = theme paper).

## Contracts/docs restated
- docs/trusted-resource-permissions.md gains "The player's surface": app owns the ground; exactly three publisher crossings (plate, one accent, the name); a fourth requires amending that section; the tour catches regressions.
- Refusal height assertion exact (one declared 16px line height, tolerance removed).
- Tour: clip geometry fixed (CSS-pixel captures at 0.913 zoom were ~57px off), below-fold clips fixed, narrow band via device-metrics override (minWidth 900 x zoom puts resizable floor at 986 > the 979 breakpoint), imprint press by name, cold-fetch window for reaching, forgetCapture() deletes stale files instead of leaving wrong pictures under right names. Two captures withdrawn rather than faked (sheet-reaching; warm-network reaching).
- app.tsx F6 pane target follows .transport-play (named in comment; addPane drops null-target panes silently).

## Also landed from Build 1's deferred list
Follow pill no longer covers the last row (list reserves the pill band, clears by 15px). Transcript roving tabindex (1 stop, arrows/Home/End, stop follows focus; 1 → 656 asserted). 1px failure height. Focus-mode disc LOOKED AT and kept: casts the app's shadow now, ring is the fitted accent, play drops its fill at 54px.

## Gates
lint clean · tests 1476/1444/0 fail/32 skipped · qa:player PASS end-to-end WITH screenshots (real Electron + network audio) · qa:study-workspace-bar PASS 6/6.
Environment note: the QA profile library (~/dev/.quire-qa/library) had no .artifacts; resources/transcripts/references/anchors/passage-index were APFS-cloned from ~/ScriptureLibrary (outside the repo).

## Captures
26 files at docs/ui-audit/podcast-player/ (paper/ink/porcelain/onyx + translucents + forced-colors; dock states incl. reaching/refused/part-heard/scrub-focus/margin-closed/notes-surface; sheet + passages + search; disc; focus-mode; narrow; unbranded in two atmospheres; card-before-press).

## Handed to Build 3
- TransportPlayButton (exported from PodcastPlayer.tsx) + .transport-play: COMPOSED, not inherited — consumer sets --transport-size and passes label/onPress/paused/pressed; gets accent fill, paper glyph, crossfade, hover/press/focus, reduced-motion, forced-colors free. Card does it at 28px in one line. SkipButton + the 24-grid non-scaling-stroke icon grammar reusable the same way.
- TaughtHereBlock rows (LivingMargin.tsx:411-517) are the fourth audio-starting surface with NO transport affordance — should take TransportPlayButton at ~22-24px; --player-accent already resolvable in .trusted-resource-card/.podcast-dock scopes.
- MediaSession artwork: the brand marks in src/renderer/assets/brand/ are the obvious local-path candidate; the plate proves they render.
- Left open deliberately: compact study pane stops ~72px above the dock (margin's own geometry, not the player's); .podcast-chapters unchanged; --podcast-dock-h ~2px ResizeObserver trail; karaoke stays refused.
