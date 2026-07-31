# The brand inventory — what each publisher has, and what is still missing

Written 2026-07-30, from the taste pass on Player Wave 2.

`docs/trusted-resource-permissions.md` is the boundary: what may be shown, on
whose say-so, and where. **This file is the stock-take.** It answers one
question per publisher — *is this identity as good as it can honestly be?* —
and names the asset that would close each gap. It is a working list, not a
grant. Nothing here authorises anything; the permissions file does that.

Every ratio below was measured in the running engine (Chromium's own computed
styles, Paper atmosphere unless stated) by `scripts/qa-podcast-player.mjs`, not
computed from hex by hand.

## Where an identity can appear

Four surfaces, one object at four sizes:

| Surface | Size | What it carries |
|---|---|---|
| Dock masthead (`.podcast-mast-plate`) | 26px | mark, or name in the publisher's ink |
| Shelf plate (`.trusted-resource-imprint`) | 26px | mark, or name; plus a tally |
| Card plate (`.taught-here-plate`) | 16px | mark; the run's repeats reduce it to a 4px rule |
| System Now Playing artwork | 512px | mark on the brand ground, or nothing |

The radius on all of them is the app's own law — ≈ 0.22 × the shorter side,
rounded even, capped at 8 — so 6 at 26px and 4 at 16px. **This is what the
2026-07-30 pass fixed:** the shelf was 30px with a 14px corner, which is a
full-round pill, and a pill is foreign to this frame. The colours were never
the problem.

## The eleven, at a glance

| Publisher | Mark | Form | Accent | Ink on their ground | Gap |
|---|---|---|---|---|---|
| Working Preacher | ✅ `wp-stacked-white.svg` | white reverse | = surface | 6.95:1 | — |
| BibleProject | ✅ `bp-mono-wht.png` | white reverse (raster) | = surface | 5.72:1 | vector master |
| The Gospel Coalition | ✅ `tgc-mark-wht.svg` | white reverse | = surface | 5.76:1 | — |
| Enter the Bible | ✅ `etb-main-logo-colour.svg` | **colour** artwork | re-picked `#fa4616` | 11.95:1 | — |
| Naked Bible Podcast | ⚠️ `naked-bible-emblem-white.png` | emblem only, name set in type | re-picked `#d9a441` | 10.41:1 | a legible wordmark |
| Spoken Gospel | ✅ `spoken-gospel-lockup-white.png` | white reverse (raster) | = surface | 3.24:1 *(never drawn)* | vector master |
| Ask N.T. Wright Anything | ❌ none | name in type | = surface | **4.88:1** | approval + reverse |
| 5 Minutes in Church History | ❌ none | name in type | = surface | 5.42:1 | approval + reverse |
| 40 Minutes in the Old Testament | ❌ none | name in type | = surface | 5.33:1 | approval + reverse |
| The Listener's Bible Commentary | ❌ none | name in type | re-picked `#26518c` | 12.50:1 | approval + a mark at all |
| Radically Christian | ❌ none | name in type | re-picked `#3f6fb0` | 10.09:1 | approval + reverse |

"Ink on their ground" is the publisher's `--resource-ink` measured against
their `--resource-source` — the pairing that carries the name where there is no
mark. The floor is 4.5:1 (Law 6, normal-weight text).

## The five colour-only shows are colour-only on purpose

`ask-nt-wright`, `five-minutes-church-history`, `forty-minutes-ot`,
`listeners-commentary` and `radically-christian` were added on the public-feed
footing and **have not been asked**. Their marks are not missing by oversight;
showing one would be the thing this project has decided not to do before a
conversation. What they get instead is their own colour and their own name set
in type, which the permissions file's generic treatment already prescribes.

Two of the five have usable artwork already sitting in
`src/renderer/assets/brand/pending/`, staged and unused:

- `premier-unbelievable.png` and `pending/reversed/premier-unbelievable-white.png`
  (Ask N.T. Wright Anything, published by Premier Unbelievable?)
- `ligonier-tree.png` and `pending/reversed/ligonier-tree-white.png`
  (5 Minutes in Church History, published by Ligonier)
- `pending/reconstructed/ask-nt-wright-horizontal-white.png` — **reconstructed,
  not supplied.** It is not the publisher's file and must not ship on the
  strength of being in the repo.

Nothing in `pending/` is approved. The directory is a staging area and the
renderer cannot reach it: the mark rule attaches artwork per source by explicit
declaration, never by a default, so a file sitting in `pending/` draws nowhere.

Three shows have **no candidate asset at all**: 40 Minutes in the Old Testament
(1517), The Listener's Bible Commentary, and Radically Christian.

## Per publisher

### Working Preacher — complete
Stacked white wordmark, 3.266:1, on their brick `#9d2235`. Accent is the
surface. Nothing outstanding.

### BibleProject — complete, but rasterised
`bp-mono-wht.png` at 4.353:1 on their cyan `#00b3e5`. Renders correctly at 16
and 26px, but it is a PNG doing a wordmark's job: at the 512px system-artwork
size it is being scaled well past its natural resolution.
**A good asset:** the SVG of the same approved mono-white lockup.

### The Gospel Coalition — complete
`tgc-mark-wht.svg`, 2.273:1, on `#79ae4a`. Vector, clean at every size.

### Enter the Bible — complete, and the exception worth remembering
The only publisher whose artwork is **colour** rather than a reverse: a yellow
tile, orange "BIBLE", black type. So its plate is that tile's own yellow
`#fed141` and the artwork ships unmodified.
Its accent was **hand-re-picked to `#fa4616`** — their own orange — because a
0.87-lightness yellow fitted to a light atmosphere lands on a muddy ochre that
is nobody's brand. Hue and chroma are untouched; only lightness is clamped.

### Naked Bible Podcast — approved, but the wordmark is unusable
Their published wordmark is a single hairline of small caps: illegible at 16px
and no better at 26. The emblem was lifted from the 2000px cover art and
reversed, and the app locks it up with the show's name set in small caps —
because an emblem alone at 19px identifies nobody. The lockup is **ours**, not
theirs, and that is a standing debt.
Its accent was **hand-re-picked to `#d9a441`**. It had been `#6e7a80`, a grey
lifted off a near-black surface to hold a 3px rail that no longer exists; as an
accent that made the loudest control on the dock a grey disc, which reads as
disabled. The gold is the colour their own palette already spends on its
loudest control.
**A good asset:** a horizontal lockup — emblem plus wordmark — drawn for small
sizes, reversed to one ink, from the publisher.

### Spoken Gospel — complete, with one number to know
Their horizontal lockup reversed to one ink, 7.671:1 — the widest mark on the
shelf, which is why it is sized by weight (21px at plate scale) rather than by
matching another mark's height.
Their `--resource-ink` (cream `#faf0d7`) against their green `#239948` is
**3.24:1**, under the floor — and it is never drawn, because the mark is
artwork with the name indented behind it. It is recorded here so that nobody
introduces a name form on that plate without re-picking the ink first. A darker
cream or their own dark green would clear it.
**A good asset:** the vector master of the same lockup, for the 512px artwork.

### Ask N.T. Wright Anything (Premier Unbelievable?) — the tightest pairing
Two colours on white: blue `#0079a8` carries, red `#d8183c` answers.
No approved mark, so its name is **drawn as text** — the only palette on the
shelf whose ink is body copy rather than decoration. `#eaf6fb` on `#0079a8`
measured **4.44:1**, under the floor by a hair, so the ink was changed to pure
white on 2026-07-30: **4.88:1**. A reversed wordmark is white in their own
usage anyway. `--resource-ink-soft` and `--resource-line` stay sampled; neither
carries text.
**A good asset:** the supplied Premier Unbelievable? reverse, approved. The
file staged in `pending/reversed/` looks right; the approval is what is missing.

### 5 Minutes in Church History (Ligonier) — palette is ours, not theirs
Their emblem is a black tree on white and their app tile a sage gradient. The
surface `#45696a` is that tile's family **darkened by us** until a light ink
holds on it — so this is the weakest colour claim of the eleven: defensible,
but not sampled from a flat brand colour the publisher publishes.
**A good asset:** Ligonier's stated brand colour, and the tree reversed to one
ink (staged at `pending/reversed/ligonier-tree-white.png`).

### 40 Minutes in the Old Testament (1517) — no candidate
Surface `#a8402a`, sampled from 1517's brick tile, whose own mark is a white
wordmark on that brick. Nothing staged.
**A good asset:** 1517's white wordmark, and confirmation that the brick is
their published value rather than a sample off a tile.

### The Listener's Bible Commentary — the only light plate
Navy `#0a2450` on pale blue `#dfeaf8`, which is how the show's own cover reads.
Its accent was **hand-re-picked to `#26518c`**: the surface is a pale tint, and
a pale tint fitted to a light atmosphere is not an accent. The navy is their
own second colour.
No mark exists at any size, staged or otherwise. At 12px on the shelf its full
name fits; on a 16px card plate it truncates.
**A good asset:** any wordmark at all, plus a short form for card scale.

### Radically Christian — no candidate
An oxblood drop over a blue ripple: `#6d1409` takes the surface, the ripple
`#1d4f8f` the pill, which is the relation their own logo has. Accent
**hand-re-picked to `#3f6fb0`** for the same reason as the Listener's — a
near-black surface makes a dead accent.
**A good asset:** the drop reversed to one ink, and their published colour
values rather than samples.

### The unregistered fallback — checked, and it is a real configuration
A feed with no palette block takes `--study-gold` and the theme's own paper as
its ink. That pairing is correct **by construction** in all four atmospheres:
each atmosphere picks its gold to hold against its own paper, so paper on gold
is the same number back. This is the case that used to draw a white play glyph
on a near-white pill.

## What the 2026-07-30 pass changed

1. **The shelf ink was never declared.** `.trusted-resource-imprint` painted
   `--resource-source` and set no colour, so a `<button>`'s initial ButtonText
   — flat black, not even the app's ink — was drawn on the publisher's own
   colour. Measured before: Radically Christian **1.75:1**, 40 Minutes in the
   Old Testament **3.43:1**, 5 Minutes in Church History **3.48:1**, Ask N.T.
   Wright Anything **4.30:1**. Four of the five name-in-type plates failed, and
   the fifth passed only because its ground is pale. The fix is one line —
   `color: var(--resource-ink)` — because every palette already declares the
   ink its own ground was chosen for.
2. **Ask N.T. Wright's ink** moved from `#eaf6fb` to `#ffffff` (4.44 → 4.88).
3. **The plate law reached the shelf**: 30px/14px → 26px/6px, the dock's own
   numbers.
4. **The wordmark is drawn once per run.** A run of four cards from one
   publisher stamped the same mark four times; now the first card carries it
   and the rest carry the plate reduced to a 4px rule in the same colour.
   Permission-wise this is *narrower* than what it replaces: the same approved
   colour, no artwork.

## Gates that hold this

- `scripts/qa-podcast-player.mjs` — the shelf's plate geometry (`26/6px`,
  exactly one value across all chips); every name-in-type plate's ink against
  its own ground at ≥ 4.5:1, measured on the dense chapter where all eleven are
  on screen; no publisher's artwork drawn on two consecutive cards; and the
  existing sweep of all twelve palettes × four atmospheres for the fitted
  accent (worst: light 4.91, dark 5.91, porcelain 5.08, onyx 5.84).
- `tests/resources-contract.test.ts` — the plate law and the declared ink as
  source assertions, and the run's one-mark rule.
- `tests/trusted-resource-permissions.test.ts` — which sources may carry a mark
  at all.

## Open, and deliberately not done here

- No mark is added for any of the five public-feed shows. Approval first.
- The Naked Bible lockup is ours; it should be replaced by a supplied one.
- Two rasters (BibleProject, Spoken Gospel) are doing vector work at 512px.
- 1517's, the Listener's and Radically Christian's palettes are sampled from
  artwork rather than read off a published brand value. They are honest samples
  and they are not the same thing as a stated colour.
