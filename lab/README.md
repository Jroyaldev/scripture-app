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

## The language (v2, phrase-anchored)

Marks key on **exact words**, not verse blocks. Geometry is measured from live DOM
ranges (the same approach `HighlightUnderlay` uses), so what renders here is what the
real canvas overlay would emit.

- **Phrase key** — a fine underline under the exact words that carry the shape.
  Solid = parallel/contrast/mirror member · dotted = echo · double = hinge.
- **Connector** — a hairline drawn word-to-word, always resting in the gutter lane;
  it never crosses text. Broken at midpoint = contrast. Dotted = echo.
- **Spine** — a whisper (1px, 22%) vertical for wide block structures
  (forming/filling, one letter's span). Absence stays absent; no invented chrome.
- **Gold is a verb** — hover/focus recolors one pattern to gold and dims the rest;
  a tooltip names it only on request. Sheet, shape view, and legend focus in sync.
- **Data keeps its color** — parallel green · contrast pink · echo blue ·
  mirror purple · series amber, drawn from the five highlight-wash hues.

Three render dialects (switcher top right):

| dialect | gesture |
|---|---|
| Arcs & ribbons | soft beziers through the gutter |
| Orthogonal | schematic elbows, dashed variants |
| Glyph-first | tiny symbols above key words, quietest at rest |

## Studies

- **Psalm 1** — same-chapter contrast (vv. 1–3 / 4–5), frame echo (vv. 1 / 6), v. 6 hinge.
- **Genesis 1:3–2:3** — mirror: days 1–3 form, days 4–6 fill; series: the
  “God saw that it was good” refrain ×7.
- **Revelation 2–3** — series: one letter shape seven times; the matrix shows
  presence/absence (Smyrna has no rebuke, Laodicea no commendation) and the
  ear-promise flip after Thyatira.

## Data model prototype

`patterns.js` is the payload draft for `annotations/shape-marks.jsonl`:
closed `kind` vocabulary, canonical translation-free refs (INV-5), and phrase keys
whose char offsets are computed per translation at render time — never stored.
Every sheet's “pattern records” disclosure shows the exact JSON.

All text is real WEB, extracted verbatim from `data/scripture/text/web`.
