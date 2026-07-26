# Quire — redesign status

Branch `codex/quire-redesign`, worktree `/Users/jonnyroyal/dev/scripture-app-quire`,
branched from `codex/pericope-integration` at d3712ab.

Source of truth for the design is `templates/quire-handoff/HANDOFF.md` and the
per-surface studies beside it. This file records only what has and has not been
built, and where the build deliberately departs from the handoff.

## Done

| Phase | Study | Commit |
|---|---|---|
| 1 | Fonts | `feat: vendor the Quire faces and drop the font CDN` |
| 2 | Tokens (§4) | `feat: rebuild the token layer on two planes and two accents` |
| 3 | B·2 — fillet, page inset | `feat: fuse the active tab into the page with a concave fillet` |
| 4 | A — nav rail, B — register | `feat: make the rail canvas and the register a register` |
| 5 | D — canvas, C — margin | `feat: leave the text block alone and flatten the margin` |
| 5 | D — pericope fold | `feat: retire two marking surfaces, and give the canvas its pericope fold` |
| 5 | C·2 — word distribution | `feat: replace the word-distribution donut with three ranked rows` |
| 6 | E — passage header | `feat: quiet the passage header into one 48px band` |
| 7 | G — two surfaces | `feat: retire two marking surfaces, …` |
| 8 | H — narrow shell | `feat: build the narrow shell (H)` |
| 9 | I, I·2 — themes + material | `feat: collapse six themes into four appearances and one material` |

`npm run lint` is clean and the design contracts assert the Quire rules rather
than the ones they replaced, so a regression toward the old system fails a test
instead of passing quietly.

## Not done

- **F — palette and search.** Query-shape routing, the scope line with *change*,
  `⇥` cycling, keeping Intelligence out of local result sets, and SearchView's
  fixes (drop the 34px empty-state icon, move the count out of the field, add
  the out-of-scope count, no sort control). The header half of phase 6 landed;
  this half did not.
- **G·2 — the full action set.** The surfaces are down to two, but the bar's
  fixed contents (five swatches, then Note · Connect · More, with Remove taking
  Note's slot), the eleven actions in three kinds, Connect replacing the bar
  with its four draft states, and the ten states as shared components are all
  outstanding. So is one loading device everywhere: `.marking-*` still has
  spinner-shaped affordances the state study bans.
- **H·2 — mobile behaviour.** The narrow *shell* is built; the gesture grammar
  is not. Missing: horizontal page swipe for chapters, long-press on Read for
  the register list, tap-to-select-verse with 10px grips on the gutter mark,
  the peek↔dock cross-fade at 120ms, nav hiding past the half stop, and drag
  between the three sheet stops. The bottom-edge budget is also unresolved —
  nav, dock and sheet peek can currently coexist, which is the 25%-of-screen
  problem H·2 names.
- **C·2 — the entry skeleton.** Margin entries are still rows rather than the
  six-part hanging-indent skeleton, and the bearing line ("1,050 km NW of
  Jerusalem") is not built.
- **Stated losses are not stated.** H requires the narrow shell to *say* what it
  gives up — compare re-labelling to "Compare in a tab", connection threads
  announcing that tracing needs the sheet, groups surviving as overflow labels.
  The concessions are made; the sentences are missing.
- **Connections.** Correctly untouched — §7.3 parks both attempts.

## Departures from the handoff, and why

**Source Serif 4 does not cover polytonic Greek.** §4 says it does. It does not,
in Google's build (919 glyphs, monotonic only) or in Adobe's upstream release.
Left as a fallback stack this is the silent-failure mode §4 warns about for
Hebrew: `ἐν ἀρχῇ` would set ν/ρ/χ in Source Serif and ἐ/ἀ/ῇ in a system face,
splitting one word across two faces. Greek and Hebrew are therefore declared
under the reading family's own name with an explicit `unicode-range` — Noto
Serif for Greek, Noto Serif Hebrew for the niqqud — so each script resolves to
exactly one face. See `scripts/vendor-fonts.mjs`.

**The register's abbreviations are derived, not authored** — see below. Two
further departures worth recording:

**`--bg-secondary` survives as "sunk".** The two-plane rule would retire it, but
it has ~100 consumers and collapsing them all onto canvas in one pass could not
be verified surface by surface. It now holds the sunk value rather than a third
warm tint. Worth a dedicated pass.

**The register's abbreviations are derived, not authored.** §5 of the repo patch
asks for a fixed abbreviation table. Rather than author 66 new strings, the
label uses the existing `data/scripture/book-names-en.json` short forms, keeping
the full name where it is already five characters or fewer so that ACTS, MARK
and JOHN are not clipped to ACT, MAR and JOH for no width at all.

**Marking becomes the dock below 979px regardless of preference.** H's table
says narrow uses the dock, but does not say what happens to a reader who chose
the palette. Overriding while overwriting nothing seemed the honest reading: a
floating palette at 390px has nowhere to float that is not over the words it is
about.

**Pericope folds admit only `kind === "section"`.** The data carries four other
kinds. Acrostics are letter glyphs rather than titles, and in Psalm 119 each
stanza emits both the Hebrew letter and its transliteration at the same verse —
admitting them would stack duplicate folds down the whole psalm. Superscriptions
belong to the text and major sections are a scale above the fold.

## Pre-existing bug found on the way — FIXED

Cold-starting a library validates every connection anchor and refused to boot
with `"Canonical token anchor must contain only its passage and exact
selector"`. Unrelated to the redesign.

**This section previously named two failing shapes and got both numbers and one
of the diagnoses wrong.** Corrected by cross-tabbing anchor shape against
`format_version` over all anchors in the log:

- **64** anchors carry `selection_shape` on `format_version: 2` records. This
  was the entire defect. The field was removed from the writer without a
  migration, and `validateBackboneTokenAnchor`'s `ANCHOR_KEYS`
  (`src/core/annotations/backbone-token-anchor.ts:97`) is deliberately closed,
  so every one of them was refused.
- 20 anchors carry `render_locator`, but those are `format_version: 1` records
  and **were never a defect** — `validateConnectionRecord` dispatches on
  `format_version`, and `parseConnectionV1` / `parseLegacyAnchor` accept that
  shape correctly.

It stayed hidden while an instance was already running because the projection is
only re-derived on a cold start.

The fix is a read-time migration
(`src/core/annotations/retired-anchor-fields.ts`) that strips retired fields
**by name** — never a blanket "ignore unknown keys" — applied on the two read
paths only: the annotations reader (`validateConnectionRecord`) and the SQLite
projection's `hydrateExactConnectionAnchor` (`src/host/sqlite.ts`). The
authoring path (`validateNewConnectionRecord`) applies none of them, so a
retired field cannot re-enter the log.

The log is never rewritten. That matters: of the 64, 50 carried nothing `exact`
did not already say, but **14 disagreed** — `selection_shape` recorded which
selected tokens were content words versus function words, and `exact` is the
wider set. Anchor identity is untouched (`exact` passes through byte for byte),
and the content/function split stays on disk, recoverable by a future feature.
Promoting `content_occurrences` into `exact` would have minted a narrower, wrong
identity for exactly those 14.

Because a projection whose marker matches the log is never rebuilt, the SQLite
tolerance is permanent for existing libraries, not transitional.

## Running it

The QA instance uses its own Electron profile and a **copy** of the library, so
it never touches `~/Desktop/Test`:

```bash
npm run build && npm run build:renderer
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron dist/electron/main.cjs \
  --remote-debugging-port=9222 --user-data-dir=/Users/jonnyroyal/dev/.quire-qa/profile
```

Screenshots land in `docs/ui-audit/quire/`.
