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

## The language (v5 — annotation ink and passage score)

The page stays scripture-first. In Paper, keyed phrases rest on a quiet highlight
wash; in dark atmospheres their ink carries a faint kind tint. Touching a phrase
wakes its siblings and clicking holds the relationship. Shared words can still
carry more than one pattern.

The two views now answer different questions:

- **Reading** asks “where does this relationship live in the prose?” It keeps the
  exact-word emphasis and the same source-linked line geometry inside the page.
- **Traces** asks “what architecture have I annotated in this passage?” The lines
  remain core: the focused annotation owns the nearest gutter lane at full ink,
  while up to three held comparisons remain as quiet routed lanes. A bounded
  passage score in the right margin lists every annotation, expands one exact
  source path, carries its observation, and returns to each marked phrase. If more
  than four are held, the score keeps them all switchable and says how many remain
  lined instead of allowing an unbounded cable field.
- **One line type.** Every trace — any kind, any density — draws as the same
  tapered ink ribbon; kind speaks as hue plus its named label in the score.
  Per-kind line signatures (double rule, break, dotted, diamond, ticks,
  bracket) were retired: at reading size a second line type reads as a
  rendering artifact, not a meaning. The score's compact overview and
  expanded source path use the same single rule.
- **Off-screen state is explicit.** Each source row says above, below, or here and
  remains a real button back to the passage.
- **Dense study** is a reversible stress fixture: Psalm 1 grows from 3 to 14 traces,
  including overlap, same-line, adjacent-line, multi-member, and full-span cases.
  It exists to expose a false density strategy before anything reaches the app.
- **Long text** is the companion annotation fixture: all 51 verses of Revelation
  2–3 remain untruncated while 18 additional relationships grow the margin score
  from 4 to 22 traces (92 additional exact-source anchors).
- **Angle proof** isolates the connector grammar from verse boundaries. It lays
  out parallel, contrast, echo, hinge, mirror, and series at exactly three
  rendered-line distances: same line, one line apart, and many lines apart. Each
  case stays inside one synthetic row/reference and runs from a phrase in the
  middle of a rendered line to one at its right edge. The resulting 18 cases make
  terminal contact, interline clearance, margin turns, rail joins, and kind
  signatures directly comparable without pretending the fixture is Scripture.
- **Reveal all** keeps the precept-style phrase affordance. It does not reveal a
  connector field or pin every annotation.

Select any words to author a pattern. The existing kind palette, live provisional
wire, notes, rename, member editing, undo, local prototype persistence, and SVG
export remain available in both views.

Connector planning lives in `trace-geometry.js`, a browser-neutral helper shared
by the lab renderer and `tests/pattern-shapes-geometry.test.ts`. It preserves all
wrapped client rects and aligns the contact dot with the underline. Same-line
relationships use a leading-constrained local cradle; different-line
relationships drop into their measured interline corridors, turn on the true
margin, and return through whitespace. Multi-member threads share that margin
rail and use rounded, port-trimmed shoulders; members on one rendered line share
a port before forking in the corridor.

## Studies

- **Psalm 1** — same-chapter contrast (vv. 1–4), frame echo (vv. 1 / 6),
  v. 6 same-line hinge, plus the optional 14-trace density fixture.
- **Genesis 1:3–2:3** — mirror: hover a forming day's "Let there be …" and its
  filling-day answer wakes (day 1↔4, 2↔5, 3↔6); the goodness refrain threads ×7.
- **Revelation 2–3** — series: hover "I know your works" and its siblings wake
  across both chapters; the passage score makes every off-screen member directly
  navigable. The optional long-text fixture pressure-tests routed annotation lanes,
  long observations, and first-to-last source return. The matrix remains a Reading
  aid and keeps absence as data (Smyrna has no rebuke, Laodicea no commendation).

## Research direction

The redesign borrows interaction principles, not another product's surface:

- [MarginNote's Card Axis](https://www.marginnote.com/en/features/card-axis/index.html)
  and [LiquidText](https://www.liquidtext.net/liquidtextadeeperdive) show the value
  of keeping excerpts ordered and returnable to source. That became the expanded
  source path rather than a floating relationship card.
- [Muse linked cards](https://museapp.com/memos/2022-09-linked-cards/) keep links
  spatially local, while [Kumu focus](https://docs.kumu.io/guides/focus) and
  [Obsidian's local graph](https://obsidian.md/help/plugins/graph) progressively
  reduce a network to what matters now. That became one active trace with compact
  held comparisons.
- [tldraw bindings](https://tldraw.dev/sdk-features/bindings) separate a semantic
  relationship from its current visual representation. Every held annotation
  remains durable and navigable even when density disclosure limits the visible
  gutter to four routed lines.
- [Logos visual filters](https://support.logos.com/hc/en-us/articles/360016529972-Visual-Filters)
  reinforce phrase-level marking in biblical text, while
  [Biblearc](https://app.biblearc.com/about-tools) treats structure as an explicit
  study object. The passage score combines those two instincts without converting
  the page into a generic node graph.

The deliberate rejection is a global force graph or infinite canvas. Those are
good overview tools, but they sacrifice reading order and exact-source trust at
the passage scale this prototype serves.

## Data model prototype

`patterns.js` is the payload draft for `annotations/shape-marks.jsonl`:
closed `kind` vocabulary, canonical translation-free refs (INV-5), and phrase keys
whose char offsets are computed per translation at render time — never stored.
Awaken groups (gids) are derived from patterns at load, never stored.

All text is real WEB, extracted verbatim from `data/scripture/text/web`.
