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

## The language (v6 — annotation ink and the connection card)

The page stays scripture-first. In Paper, keyed phrases rest on a quiet highlight
wash; in dark atmospheres their ink carries a faint kind tint. Touching a phrase
wakes its siblings and clicking holds the relationship. Shared words can still
carry more than one pattern. The marked phrases, the washes, and the in-text
whisper are the whole discovery surface — the margin never lists what is not
held.

The two views share one connector grammar and one reading aid:

- **Reading** and **Traces** differ only in the page's typographic set (Traces
  reserves the interline room the Loom routing contract needs). Both draw every
  relationship with the same Loom-engine bracket grammar — brackets, cradles,
  and quiet held rail ticks.
- **The connection card** appears in the right margin only while a connection
  is held (click); hover alone never shows it. It presents exactly the focused
  connection: a short kind-hue tick (the line vocabulary, not an icon), the
  title (rename in place for your own marks), a quiet `kind · N moments` line,
  the observation, then the source moments as clean ref + phrase rows — the
  whole row returns to the verse and says here / above / below. Quiet actions
  close the card: Add words, Export SVG, Release, Delete, with the same
  six-second undo door as everywhere else. When several connections are held,
  the card follows the focus — switch by clicking phrases (shared words cycle:
  “2 of 3 · click for next”) or the held rail ticks — and concedes only one
  plain-text phrase to the others: `· 2 more held`. Nothing else. If more than
  four traces are held, the margin still draws at most four routed lanes; the
  rest stay switchable as ticks instead of an unbounded cable field.
- **One line type.** Every trace — any kind, any density — draws as the same
  clean uniform stroke (round caps and joins); kind speaks as hue plus its
  named label on the card. Per-kind line signatures (double rule, break,
  dotted, diamond, ticks, bracket) were retired, and the C0.5 amendment also
  retired the tapered/swelling ribbon profile: at reading size a second line
  type — or a width swell — reads as a rendering artifact, not a meaning.
- **The bracket (C0.5).** One vocabulary: horizontals colinear with
  underlines, verticals, and one soft rounded right-angle corner. Every
  contact comes straight off its underline in one level run and meets the
  rail in one soft corner — down for the top, UP for the route's bottom;
  the same-line cradle is the squared hammock; a section switch crosses its
  declared gap genuinely flat between two compact corners. Nothing slants,
  loops, or runs offset-parallel to an underline. `c05-fixtures.html`
  renders the amended silhouettes directly from the engine as a standing
  visual gate.
- **Off-screen state is explicit.** Each moment row says above, below, or here
  and remains a real button back to the passage.
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

Select any words and one compact menu offers both vocabularies: the connection
kinds above, a highlight row (five sober washes — amber, sage, sky, rose, violet)
below a divider. Highlights are not connections: they lay a quiet rounded wash
under the exact words (the production `HighlightUnderlay` discipline), coexist
with patterns on the same words (wash under, underline and connector above), and
persist in the same local store as authored patterns
(`{ type: "highlight", color, key }`). A wash is managed entirely in the text —
it never appears in the margin: click the washed words with nothing selected and
a small chip offers the one action a wash has, remove (with undo). The live
provisional wire, notes, rename, member editing, undo, local prototype
persistence, and SVG export remain available in both views.

Connector planning is the Loom engine (`route-engine.js`), shared with `route.html`
and exercised by the focused Route Engine suites; both lab views paint its output
with the C0.5 bracket grammar. `trace-geometry.js` remains a browser-neutral
measurement helper, shared by the lab renderer and
`tests/pattern-shapes-geometry.test.ts`: it preserves every wrapped client rect,
aligns the contact dot with the underline, and resolves the focused-segment hue.
Its pre-C0.5 local bow/cradle/thread planners are retained only as a pure,
unit-tested reference — no Shapes render path reaches them any longer.

## Studies

- **Psalm 1** — same-chapter contrast (vv. 1–4), frame echo (vv. 1 / 6),
  v. 6 same-line hinge, plus the optional 14-trace density fixture.
- **Genesis 1:3–2:3** — mirror: hover a forming day's "Let there be …" and its
  filling-day answer wakes (day 1↔4, 2↔5, 3↔6); the goodness refrain threads ×7.
- **Revelation 2–3** — series: hover "I know your works" and its siblings wake
  across both chapters; hold one and the connection card makes every off-screen
  moment directly navigable. The optional long-text fixture pressure-tests routed
  annotation lanes, long observations, and first-to-last source return. The matrix
  remains a Reading aid and keeps absence as data (Smyrna has no rebuke, Laodicea
  no commendation).

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
  study object. The held-lane margin and the connection card combine those two
  instincts without converting the page into a generic node graph.

The deliberate rejection is a global force graph or infinite canvas. Those are
good overview tools, but they sacrifice reading order and exact-source trust at
the passage scale this prototype serves.

## Data model prototype

`patterns.js` is the payload draft for `annotations/shape-marks.jsonl`:
closed `kind` vocabulary, canonical translation-free refs (INV-5), and phrase keys
whose char offsets are computed per translation at render time — never stored.
Awaken groups (gids) are derived from patterns at load, never stored.

All text is real WEB, extracted verbatim from `data/scripture/text/web`.
