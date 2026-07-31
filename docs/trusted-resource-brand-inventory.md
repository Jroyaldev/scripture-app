# The brand inventory — what each publisher has, where it came from, and what is still missing

Written 2026-07-30 from the taste pass on Player Wave 2.
**Revised 2026-07-30 (evening) by the brand pass**, which went and fetched the
files.

`docs/trusted-resource-permissions.md` is the boundary: what may be shown, on
whose say-so, and where. **This file is the stock-take.** It answers one
question per publisher — *is this identity as good as it can honestly be?* —
and it now answers a second: *where did this file come from, and is it theirs?*
It is a working list, not a grant. Nothing here authorises anything; the
permissions file does that.

Every ratio below was measured in the running engine (Chromium's own computed
styles) rather than computed from hex by hand.

## What changed on the brand pass

1. **BibleProject is vector.** Their own SVG, from the file their own
   `<bp-logo>` element loads. The raster it replaces was theirs too and is kept
   as the authority the ink was matched against.
2. **Five palettes moved from eyedropped to published.** Ligonier, 1517,
   Premier, the Listener's and Radically Christian all had surfaces sampled off
   a rendering of their artwork. Four of the five are now read off the
   publisher's own design tokens or their own logo file; the fifth (Premier's
   surface) is a documented darkening of their published blue, with the reason
   stated and measured.
3. **One new mark is drawn**: Ligonier's tree, for 5 Minutes in Church History,
   in a new and narrower form — a *device* beside the show's name rather than a
   mark in place of it.
4. **Four more official files were fetched and are NOT drawn**, each for a
   measured reason recorded below. That is the honest answer to "use logos when
   we can": we can, for one of the five, and the other four are staged with
   their numbers so nobody has to re-litigate it by eye.
5. **The `pending/` directory is now provenanced.** Every file in it says where
   it came from and why it is not shipping.

## Mark, device, name — three forms, and the difference matters

| Form | What it is | Who has it |
|---|---|---|
| **Mark** (`--resource-mark`) | The publisher's lockup, drawn **instead of** their name. The name stays in the accessibility tree, indented off-screen. | The six publisher-granted sources |
| **Device** (`--resource-device`) | The publisher's emblem, drawn **beside** the name, which stays in type. | 5 Minutes in Church History |
| **Name in type** | The source's name set in the publisher's own ink on the publisher's own ground. | The other four |

The device is not a small mark; it is a different relation to the name.
Ligonier's tree identifies *Ligonier*, and 5 Minutes in Church History is a
show Ligonier publishes. A tree where the title was would say "Ligonier" and
stop. So the tree stands next to the title and neither is asked to do the
other's job. That distinction is also why it is a separate custom property and
a separate constant in `tests/trusted-resource-permissions.test.ts`: the two
grants have two different footings, and one property doing both jobs would
have lost the segmentation the permissions file exists to keep.

## Where an identity can appear

Four surfaces, one object at four sizes:

| Surface | Size | What it carries |
|---|---|---|
| Dock masthead (`.podcast-mast-plate`) | 26px | mark, or device + name, or name |
| Shelf plate (`.trusted-resource-imprint`) | 26px | the same; plus a tally |
| Card plate (`.taught-here-plate`) | 16px | the same; the run's repeats reduce it to a 4px rule |
| System Now Playing artwork | 512px | mark on the brand ground, or nothing |

The radius on all of them is the app's own law — ≈ 0.22 × the shorter side,
rounded even, capped at 8 — so 6 at 26px and 4 at 16px.

## The eleven, at a glance

Measured on the dense chapter's shelf, Paper atmosphere, 2026-07-30 evening.

| Publisher | Artwork | Form | Official? | Vector? | Ink on their ground |
|---|---|---|---|---|---|
| Working Preacher | `wp-stacked-white.svg` | mark | ✅ byte-identical to their file | ✅ | 6.95:1 |
| BibleProject | `bibleproject-lockup-white.svg` | mark | ✅ their outlines, their mono-white ink | ✅ | 5.72:1 |
| The Gospel Coalition | `tgc-mark-wht.svg` | mark | ✅ | ✅ | 5.76:1 |
| Enter the Bible | `etb-main-logo-colour.svg` | mark (**colour**) | ✅ | ✅ | 11.95:1 |
| Naked Bible Podcast | `naked-bible-emblem-white.png` | mark + our lockup | ⚠️ emblem lifted from their cover art | ❌ | 10.41:1 |
| Spoken Gospel | `spoken-gospel-lockup-white.png` | mark | ✅ | ❌ | 3.24:1 *(never drawn)* |
| 5 Minutes in Church History | `ligonier-tree-white.svg` | **device** | ✅ their masthead, their fill | ✅ | 5.70:1 |
| Ask N.T. Wright Anything | *staged, not drawn* | name | ✅ acquired | ✅ acquired | 4.88:1 |
| 40 Minutes in the Old Testament | *staged, not drawn* | name | ✅ acquired | ❌ | 5.46:1 |
| The Listener's Bible Commentary | *staged, not drawn* | name | ⚠️ plated | ❌ | 13.33:1 |
| Radically Christian | *staged, not drawn* | name | ✅ acquired | ❌ | 9.82:1 |

"Ink on their ground" is the publisher's `--resource-ink` measured against
their `--resource-source` — the pairing that carries the name where there is no
mark. The floor is 4.5:1 (Law 6, normal-weight text). Every plate that draws a
name clears it in all four atmospheres; verified by capture on this pass.

**Four of the accents changed on this pass, so the fitted-accent sweep was
re-run**: all twelve palettes against all four atmospheres, in the running
engine, resolving `oklch(from …)` by painting it and reading the pixel back
rather than by parsing the function text. Worst case per atmosphere —
**light 4.91, dark 5.91, porcelain 5.08, onyx 5.84** — which is *identical* to
the figures recorded before the change. The clamp absorbed Ligonier's olive,
Premier's blue, the Listener's navy and Radically Christian's ripple without
moving the floor, which is exactly what it exists to do.

## Provenance — every file we ship

| File | Source | Official | Form | Notes |
|---|---|---|---|---|
| `wp-stacked-white.svg` | `workingpreacher.org/wp-content/uploads/2024/09/WP_Stacked-White.svg` | yes | vector, **reverse** | Re-fetched 2026-07-30 and **byte-identical** (sha256 `be2f9cb5…`) to what is in the tree. |
| `bibleproject-lockup-white.svg` | `static.bibleproject.com/bp-web-components/v0.27.2/bibleproject.svg` | yes | vector, **reverse** | Their own outlines, unaltered. The two fills (`#00B3E5` mark, `#010101` wordmark) set to `#FFFFFF` to reproduce the publisher's own mono-white variant — which we already had as a supplied raster and which is kept beside it. Not a trace, not a recolour to app ink. 208:48. |
| `tgc-mark-wht.svg` | The Gospel Coalition, mono/white variant, in tree since 2026-07-26 | yes | vector, **reverse** | Not re-verified against a live URL on this pass. |
| `etb-main-logo-colour.svg` | Enter the Bible, in tree since 2026-07-27 | yes | vector, **colour** | The one colour artwork. Ships unmodified on the tile's own yellow. Never mask it — a mask flattens it to a silhouette. |
| `naked-bible-emblem-white.png` | Lifted from the Naked Bible Podcast's 2000px cover art and reversed to one ink | **no — derived** | raster, reverse | Their published wordmark cannot do this job; see below. The emblem-plus-name lockup is **ours**, and that is a standing debt. |
| `spoken-gospel-lockup-white.png` | Spoken Gospel's horizontal lockup, reversed to one ink | yes (artwork), derived (reverse) | raster, reverse | 629×82. No vector is published anywhere we could find; see below. |
| `ligonier-tree-white.svg` | The masthead of `ligonier.org` (their `icon-24-logo` element) | yes | vector, **reverse** | The path carries no fill of its own — Ligonier's own markup paints it with a CSS class, `!fill-white` — so `fill="#ffffff"` is the colour their page supplies rather than a recolour by us. 1:1. |

Every one of these is a bundled local asset. Nothing is fetched from a
publisher at runtime, and `tests/trusted-resource-permissions.test.ts` asserts
both facts against the file system.

## Provenance — every file staged and NOT drawn

`src/renderer/assets/brand/pending/` is a staging area. **The renderer cannot
reach it**: artwork attaches per source by explicit declaration, never by a
default, and the permissions test asserts that no `--resource-mark` or
`--resource-device` URL points inside `pending/`.

| File | Source | Official | Why it is not drawn |
|---|---|---|---|
| `premier-unbelievable.svg` | Inline SVG from the masthead of `premierunbelievable.com` | **yes**, vector, colour | Stacked lockup, 200:120. At the plate's 26px it is 43px wide and the "Faith Explored" strapline is under 2px tall. Fetched on this pass; supersedes the 200×120 PNG beside it. |
| `premier-unbelievable.png` | earlier capture | unclear | Superseded by the SVG above. |
| `reversed/premier-unbelievable-white.png` | a reverse of the above | derived | Same geometry, same problem. |
| `reconstructed/ask-nt-wright-horizontal-white.png` | **drawn by us** | **NO** | **Reconstructed, not supplied.** It is not Premier's file. It must never ship on the strength of sitting in this repo, and no amount of it looking right changes that. |
| `1517-roundel.png` | `1517.org/hubfs/1517-logo-email-500x500-2021-Feb.png` | **yes**, raster, colour | The numeral is **20.6% of the roundel's own height** — 3.1px of ink at the 15px a shelf chip gives a device, 1.6px at a card's 8px. Measured off the file, not judged by eye. Its brick `#A73D2D` is now the source's surface, so the colour survives even though the mark cannot. |
| `listeners-commentary-cover.png` | `listenerscommentary.com/wp-content/uploads/2026/05/…` | yes, raster | The show's square cover, not a wordmark. It is the file the palette below was read off. |
| `listeners-commentary-sitelogo-plated.png` | `listenerscommentary.com/…/2022/07/logo1-…png` | yes, raster | Their horizontal wordmark — with a **grey plate `#AFACA9` and a drop shadow baked into the pixels**. Keying that out would make it our artwork. |
| `radically-christian-drop.png` | The show's own 512px logo, from their publisher's feed host | **yes**, raster, colour, transparent | Their drop is `#721203` and this card's ground is that same oxblood: it would vanish. Re-inking it is the one modification these grants forbid. |
| `ligonier-tree.png`, `reversed/ligonier-tree-white.png` | earlier captures | raster | Superseded by the official vector, which ships. |
| `naked-bible-wordmark-black.png` | `nakedbiblepodcast.com/wp-content/uploads/2019/02/Headlogo2.png` | **yes**, raster | Re-fetched 2026-07-30 and **byte-identical** (sha256 `3e385b10…`) to what was staged. Its ink measures 198×11 — an **18:1** wordmark. At 26px of plate it would be 468px wide. Confirmed unusable; see below. |
| `reversed/naked-bible-wordmark-white.png` | a reverse of the above | derived | Same aspect, same verdict. |
| `bibleproject-lockup-white-supplied.png` | BibleProject's supplied mono-white raster (was `bp-mono-wht.png`) | yes | Superseded by the vector, kept as the authority its ink was matched against. |
| `bibleproject-lockup-colour.svg` | `static.bibleproject.com/bp-web-components/v0.27.2/bibleproject.svg` | yes, vector | The unmodified colour original, kept beside the white derivation so the two can be diffed. |
| `bible-odyssey-white.svg`, `desiring-god-*`, `sbl-logo.svg` | earlier reconnaissance | — | Publishers not among the eleven. Left where they were. |
| ~~`etb-main-logo-colour.svg`~~ | — | — | **Removed on this pass.** It was a byte-identical copy of the file that ships one directory up, and a staging area that also holds shipped artwork cannot be read at a glance. The white variants beside it are kept: they are alternatives to the shipped colour art, not copies of it. |

## Per publisher

### Working Preacher — complete, and now verified
Stacked white wordmark, 3.266:1, on their brick `#9D2235`. Accent is the
surface. The file was re-fetched from their site on this pass and is
byte-identical to the one in the tree, which is the strongest provenance claim
in this document. Nothing outstanding.

### BibleProject — complete, and now vector
`bibleproject-lockup-white.svg` at 4.333:1 on their cyan `#00B3E5`. This was the
one real raster gap: at the 512px system-artwork size a 1602px PNG was being
scaled well past its resolution. The vector is their own file with their own
mono-white ink, so the 512px case is now resolution-free.
**Still open:** nothing.

### The Gospel Coalition — complete
`tgc-mark-wht.svg`, 2.273:1, on `#79AE4A`. Vector, clean at every size.
**Still open:** provenance is recorded from the tree rather than re-verified
against a live URL. Cheap to close next time anyone is in here.

### Enter the Bible — complete, and the exception worth remembering
The only publisher whose artwork is **colour** rather than a reverse: a yellow
tile, orange "BIBLE", black type. So its plate is that tile's own yellow
`#FED141` and the artwork ships unmodified.
Its accent is **hand-re-picked to `#FA4616`** — their own orange — because a
0.87-lightness yellow fitted to a light atmosphere lands on a muddy ochre that
is nobody's brand. Hue and chroma are untouched; only lightness is clamped.
**Kept, with the reason restated.**

### Naked Bible Podcast — the debt is confirmed, not closed
The lockup the app draws is emblem-plus-name, and the lockup is **ours**.
This pass went and got the publisher's own wordmark to see whether the debt
could be paid: `Headlogo2.png` from their own site, byte-identical to what was
already staged, its ink measuring **198 × 11 pixels — an 18:1 wordmark**. At
plate height that is 468px wide. The first audit's verdict ("illegible at card
size") is confirmed by measurement rather than by eye, and confirmed against
the publisher's current file rather than a remembered one.
Its accent is **hand-re-picked to `#D9A441`**, their own gold. It had been
`#6E7A80`, a grey lifted off a near-black surface for a 3px rail that no longer
exists; as an accent that made the loudest control on the dock a grey disc,
which reads as disabled. **Kept.**
**A good asset:** a horizontal lockup — emblem plus wordmark — drawn for small
sizes, reversed to one ink, **from the publisher**. Nothing short of that pays
this debt.

### Spoken Gospel — complete, still raster, and the vector does not exist publicly
Their horizontal lockup reversed to one ink, 7.671:1 — the widest mark on the
shelf, which is why it is sized by weight (21px at plate scale) rather than by
matching another mark's height.
This pass searched for a vector master: their site is Webflow and serves the
lockup as a 660×108 WEBP/PNG (the gold-leaf colour version); `/brand`, `/press`,
`/media`, `/logos` and `/style-guide` are all 404. **There is no public vector.**
That is now a known fact rather than an open question, and it is a question for
the publisher rather than for a search engine.
Their `--resource-ink` (cream `#FAF0D7`) against their green `#239948` is
**3.24:1**, under the floor — and it is never drawn, because the mark is
artwork with the name indented behind it. Recorded here so that nobody
introduces a name form on that plate without re-picking the ink first.

### 5 Minutes in Church History (Ligonier) — the pass's one new mark
**Device:** Ligonier's tree, official vector, from their own masthead, filled
with the colour their own markup fills it with. It is drawn at 15px on a shelf
chip and reads cleanly — verified by capture in all four atmospheres.
**Surface:** `#4F645B`, which is Ligonier's own `primary-800`, read off the
stylesheet `ligonier.org` serves. It had been `#45696A` — the show's app tile's
family, *darkened by us* until a light ink held — and was called "the weakest
colour claim of the eleven" by the first audit. It is now theirs. Ink on it
measures **5.70:1**, up from 5.42.
**Accent:** `#859E3B`, Ligonier's `primary-400`. Their loudest published
colour, which is what an accent is for; the surface alone made the play pill a
deep sage disc.
Worth knowing: the show's *current* artwork is a greyscale swirl with a red
bar, and shares no colour with either the old surface or the new one. The
palette follows the publisher rather than the cover, deliberately — a cover is
reissued, a brand token is not.

### Ask N.T. Wright Anything (Premier Unbelievable?) — the artwork exists and cannot be drawn
**Acquired on this pass:** Premier's official logo as **vector**, lifted from
the inline SVG in their own masthead. It is staged and it is not drawn: a
200:120 stacked lockup at 26px of plate is 43px wide, and "Faith Explored" is
under two pixels tall. A mark that turns to mush at plate size is not an
improvement, and the reconstruction someone drew to get round that
(`pending/reconstructed/`) is not Premier's file and must never ship.
**Palette, corrected:** their published values are blue `#0086BA` and red
`#E51F3F`, read out of that same vector. The red is now the pill. The blue is
now the **accent** rather than the surface, because white on `#0086BA` measures
**4.10:1** — under Law 6's floor — and this is the one palette on the shelf
whose ink is body copy rather than decoration. `#0079A8` stays the surface as
**our darkening of their blue**, measured at 4.88:1, and is labelled as ours in
the stylesheet. On the accent the clamp keeps hue and chroma theirs and makes
only the contrast ours.

### 40 Minutes in the Old Testament (1517) — the colour is theirs now, the mark cannot be
**Surface:** `#A73D2D`, read out of 1517's own logo file, replacing `#A8402A`
sampled off a tile. Ink on it measures **5.46:1**, up from 5.33.
**Acquired and not drawn:** the 1517 roundel, official, from their own site.
The numeral inside it is 20.6% of the roundel's height, so a 15px device gives
3.1px of ink. Staged with that measurement so the question stays closed.
**A good asset:** a horizontal "1517" logotype, if they have one; nothing on
their site, in their feed or in the show's artwork is anything but the roundel.
The pill ink `#7D2C1B` is still **our** darkening of their brick, and is
labelled as such.

### The Listener's Bible Commentary — the palette is theirs now; the wordmark is plated
**Surface and ink:** `#E9F3FF` and `#002558`, read off the publisher's own
current cover file rather than off a screenshot of it. They had been `#DFEAF8`
and `#0A2450`. Ink measures **13.33:1**.
**Accent:** their navy `#002558`, replacing the hand-picked `#26518C`. The
reason the palette declares an accent at all is unchanged — a pale tint fitted
to a light atmosphere is not an accent — but the value no longer has to be
invented, because the app's own lightness clamp does the fitting.
**Acquired and not drawn:** their horizontal wordmark, from their site, which
ships with a grey plate and a drop shadow **baked into the pixels**. Keying
that out would make it our artwork, which is the line this document exists to
hold. Their square cover is staged too and is not a wordmark.
**A good asset:** the wordmark on transparency, from the publisher, plus a
short form for card scale — at 16px the full name truncates.

### Radically Christian — the palette is theirs now; the drop cannot sit on it
**Surface and pill:** `#721203` and `#00408D`, read straight out of their own
512px logo file, replacing `#6D1409` and `#1D4F8F` sampled from a rendering.
Ink measures **9.82:1**.
**Accent:** their ripple blue `#00408D`, replacing the hand-picked `#3F6FB0`.
Same argument as the Listener's: a near-black surface makes a dead accent, so
this palette declares one, and the clamp rather than our taste is what fits it.
**Acquired and not drawn:** the drop, official, transparent — and oxblood, the
same oxblood as the ground it would be drawn on. It would vanish, and re-inking
it is the modification these grants forbid.
**A good asset:** a reverse of the drop, from the publisher — one ink, drawn to
sit on their own oxblood. That is a small ask and it is the whole gap.

### The unregistered fallback — checked, and it is a real configuration
A feed with no palette block takes `--study-gold` and the theme's own paper as
its ink. That pairing is correct **by construction** in all four atmospheres:
each atmosphere picks its gold to hold against its own paper, so paper on gold
is the same number back. This is the case that used to draw a white play glyph
on a near-white pill.

## Colours that are OURS, and stay ours, and say so

Values in the stylesheet picked by us rather than by a publisher. Each is
kept, and each carries its reason in a comment beside it:

| Where | Value | Why ours |
|---|---|---|
| Enter the Bible, accent | `#FA4616` | Their own orange, promoted, because their yellow fits to mud. |
| Naked Bible, accent | `#D9A441` | Their own gold, promoted, because a grey accent reads as disabled. |
| Ask N.T. Wright, surface | `#0079A8` | Their `#0086BA` darkened until white clears 4.5:1 on it. |
| 40 Minutes in the OT, pill ink | `#7D2C1B` | Their brick darkened so a light pill can carry ink. |
| Every accent's fitted form | — | `--player-accent` clamps lightness per atmosphere. Hue and chroma stay theirs; contrast on OUR paper is ours. |

## Gates that hold this

- `tests/trusted-resource-permissions.test.ts` — which sources may carry a mark
  at all, which may carry a device, that the two lists stay separate, that
  every URL is a bundled local asset that exists, and that nothing in
  `pending/` can be reached.
- `scripts/qa-podcast-player.mjs` — the shelf's plate geometry (26/6px); every
  name-in-type plate's ink against its own ground at ≥ 4.5:1, measured on the
  dense chapter where all eleven are on screen; no publisher's artwork drawn on
  two consecutive cards; and the sweep of all twelve palettes × four
  atmospheres for the fitted accent.
- `tests/resources-contract.test.ts` — the plate law and the declared ink as
  source assertions, and the run's one-mark rule.

## Open, and deliberately not done here

- **The Naked Bible lockup is ours.** Confirmed by measurement against the
  publisher's current file, not closed. Only a supplied horizontal lockup pays
  it.
- **Spoken Gospel has no public vector.** Searched and confirmed absent; it is
  a question for them.
- **Four official files are staged and undrawn** — Premier's, 1517's, the
  Listener's, Radically Christian's — each with the measurement that kept it
  staged. Three of the four would be closed by one supplied file each: a
  horizontal lockup, a wordmark on transparency, a reverse.
- **The Gospel Coalition's file was not re-verified** against a live URL.
- **Nothing here is a permission.** The 2026-07-30 decision means marks are no
  longer gated on having asked; it does not mean anybody has been asked. The
  outreach backlog is unchanged and it is still the condition for a public
  listing.
