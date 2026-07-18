# Pattern shapes · visual lab

Worktree-only prototype (`codex/pattern-shapes`) for a mark system that links recurring
shapes in direct contexts: series, mirrors, contrasts, echoes, hinges. Nothing here
touches the app; it is the aesthetic proving ground for a future `src/core/patterns`
module and a `shape-marks.jsonl` annotation log.

## Run

```bash
cd lab && python3 -m http.server 8791
# open http://localhost:8791/shapes.html
```

## The language (v3 — "the text awakens")

v2 designed a *notation* (three dialects, legends, everything drawn at once). v3
reframes it as an *interaction*: at rest the page is almost plain scripture, and the
shape only exists when you touch it.

- **At rest** — keyed phrases carry a whisper-faint dotted hint in their kind hue
  (~34% ink). Nothing else. No rails, no chips, no connectors.
- **Touch a phrase** — its whole pattern wakes: every member phrase inks in with a
  spreading underline, a connector draws itself, the rest of the sheet recedes to
  ~44% ink, and a small mono *whisper* names the shape beside the touched words.
- **Connectors live entirely in the gutter.** A dot in the margin at each member's
  line; a curve bowing left between them (2 members) or a vertical thread with
  dots-and-ticks (3+). They never cross text. Broken at midpoint = contrast,
  dotted = echo, same-line dip = hinge.
- **Click pins** a pattern awake; click again or Esc releases. Background click clears.
- **Off-screen members** surface as edge pills in the gutter ("↑ 1 more · ↓ 4 more");
  click scrolls to the nearest hidden member. The pattern is never bigger than your
  memory of it.
- **Reveal all** (topbar) is the precept-style study mode: every phrase key at full
  strength, still no connector soup.
- **Data keeps its color** — parallel green · contrast pink · echo blue ·
  mirror purple · series amber, from the five highlight-wash hues.

Phrases are real DOM spans (segment-split, so overlapping patterns share words —
PSA.1.6 "the way of the wicked" carries echo *and* hinge and wakes both). Geometry
is measured live from the spans, so marks survive reflow and translation swaps.

## Studies

- **Psalm 1** — same-chapter contrast (vv. 1–3 / 4–5), frame echo (vv. 1 / 6),
  v. 6 same-line hinge dip.
- **Genesis 1:3–2:3** — mirror: hover a forming day's "Let there be …" and its
  filling-day answer wakes (day 1↔4, 2↔5, 3↔6); the goodness refrain threads ×7.
- **Revelation 2–3** — series: hover "I know your works" and its six siblings wake
  across both chapters with edge pills; the sticky matrix highlights the element
  column in sync (absence stays data — Smyrna has no rebuke, Laodicea no commendation).

## Data model prototype

`patterns.js` is the payload draft for `annotations/shape-marks.jsonl`:
closed `kind` vocabulary, canonical translation-free refs (INV-5), and phrase keys
whose char offsets are computed per translation at render time — never stored.
Awaken groups (gids) are derived from patterns at load, never stored.

All text is real WEB, extracted verbatim from `data/scripture/text/web`.
