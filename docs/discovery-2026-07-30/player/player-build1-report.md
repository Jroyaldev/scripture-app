# Player Build 1 report (the machine) — commit 9130779 on codex/quire-redesign, 2026-07-30

## The state machine

`following: boolean` → `mode: "following" | "browsing" | "searching"` (PodcastPlayer.tsx ~:430, exposed on the list as `data-transcript-mode`, registered in scripts/qa-support/app-vocabulary.mjs). Invariant: `mode === "searching"` ⟺ the query is non-empty, enforced in one setter (`askFor`).

| From | To | On |
|---|---|---|
| following | browsing | a `scroll` on the list that is not ours |
| following / browsing | searching | the query becomes non-empty |
| browsing / searching | following | the Follow pill; clearing/emptying the box; Escape; **any seek** |
| any | following | episode change |
| searching | browsing | never — clearing goes to following, deliberately |

Every seek routes through one `goTo(seconds, { hear, show })`. `hear` distinguishes a press on a *place* (line, passage row, chapter row — starts the file) from a press on the *transport* (±15/30, scrub — preserves play state). `show` returns to the transcript only from a row. Seeks arriving from OUTSIDE the component (a moment pressed in the margin, the system scrubber) re-engage following via a module-level seek count the dock subscribes to (`usePodcastSeekMark`).

## Defects fixed

- D1 every seek re-engages following — one function, all six surfaces. D2 a hit press seeks, exits the filter, resumes following. D3 structurally impossible (effect guards on `mode === "following"`). D4 query/mode/view reset per episode. D5 strip and views decouple; derived `view` falls back to whatever exists + honest empty state. D6 autoscroll branches on `matchMedia` in JS and uses `"instant"`. D7/D8 `onWheel`/`onTouchMove` replaced by one guarded `scroll` listener (covers wheel, touch, keyboard, focus, AT virtual cursor; tap drift and extent-wheel no longer kill following). D9 a line pressed while paused plays. D10 `seekPodcast` returns `moved | queued | refused`; early seeks queue; nothing claims success over `refused`. D11 transcript renders only while the sheet is open; the depth ramp moved out of the tree onto 7 elements (~14 attribute writes per line change, not 2,280 reconciliations); blur only near the window. D12 queued seek spent before anything announced — no 0:00 flash. D13 tour repaired. §7.1 `playPodcastEpisode` with `startAt` for the already-playing episode seeks and plays; no `startAt` still toggles.
- Rate read off the element via `ratechange`, set with `defaultPlaybackRate` too; `preservesPitch` on every application. MediaSession metadata + handlers + 5s position state. One throttled live region. ARIA tabs completed (aria-controls, tabpanel, roving tabindex, arrows, manual activation).

## CSS repairs made (required by the machine)

- `--accent` was defined nowhere (search mark invisible). `--study-gold` cannot come here (already the dock's default ground). Used `--resource-pill-bg`/`--resource-pill-ink`.
- Follow pill moved before the list in tree order (keyboard reach) needed `z-index: 1` — blurred lines are stacking contexts and were swallowing the press.

## Contracts restated (dated notes)

Refusal copy ("Did not arrive. This needed the network." — old copy wanted 253px of a 223px line); the tour's dock lane (right edge 24 → --page-inset 10 since e8e2ee9); the panel's reservation (padding → margin); the failed dock's height (rate pill's 1px padding — measured, named, left to Build 2).

## Gates

lint clean. Tests 1476/1444/0 fail/32 skipped. `qa:player` PASS end-to-end against real Electron + real network audio (Naked Bible 479) — first time it ever reached past the publisher assertions. New sheet coverage: 657 lines, mode `following`, ramp on 4–7 elements, mark visible ≠ text colour, hit press moved the file 1177s, filter left, following resumed, shut sheet holds 0 buttons. Run with `--no-screenshots` — the fifteen stale captures are Build 2's to regenerate. `qa:study-workspace-bar` PASS 4/6 — the two failures are a PRE-EXISTING flake at qa-study-workspace-bar.mjs:1397 (`Math.round(chipLeft)` across two reloads flips 53/52 both directions; untouched tree also flakes; separate task filed).

## Deferred to Build 2 (the look)

- The Follow pill covers the list's last row — a coordinate press on the final hit lands on the pill.
- ~2,270 tab stops in the transcript (no roving tabindex yet).
- The 1px dock height change on failure (rate pill padding).
- `--focus-ring` is also undefined and works by accident (currentColor).
- Regenerating the fifteen stale captures (audit truth).

## Deferred to Build 3 / product

- Word-level karaoke (24,995 timed words loaded, only `line.s` read) — REFUSED by the reader's decision (line-level only); reference marks + wayfinding are Build 3.
- Library-wide transcript search.
- Auto-expanding the sheet for a `startAt` launch.
- MediaSession artwork (record carries none; fetching would cross the permission boundary — local brand marks may serve).
- `--podcast-dock-h` trails live height by ~2px after a mast reflow (dock geometry untouched by design in Build 1).
