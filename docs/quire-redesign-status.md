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
| 6 | E — passage header | `feat: quiet the passage header into one 48px band` |
| 9 | I, I·2 — themes + material | `feat: collapse six themes into four appearances and one material` |

Suite is green — 1006 passing, 0 failing, `npm run lint` clean. The design
contracts now assert the Quire rules rather than the ones it replaced, so a
regression toward the old system fails a test rather than passing quietly.

## Not done

- **F — palette and search.** Query-shape routing, the scope line with *change*,
  `⇥` cycling, keeping Intelligence out of local result sets, and SearchView's
  fixes (drop the 34px empty-state icon, move the count out of the field, add
  the out-of-scope count, no sort control). The header half of phase 6 landed;
  this half did not.
- **G, G·2 — marking.** `MarkingSurface` still ships all four surfaces
  (`"palette" | "rail" | "radial" | "dock"`). Retiring rail and radial, folding
  stacked in as a dock state, the fixed bar contents, the eleven actions in
  three kinds, and the ten states as shared components are all outstanding.
  `--marking-bottom-inset` still needs its component prefix (repo-patch §3).
- **H, H·2 — narrow shell and mobile.** Untouched.
- **Pericope folds.** §D describes a fold that does not exist in the codebase at
  all — `PericopeMark.tsx` is the brand logo, not a text-structure mark. This is
  new feature work, not restyling.
- **C·2 — the entry skeleton.** Entries are still rows rather than the six-part
  hanging-indent skeleton, the bearing line is not built, and the word panel
  keeps its donut instead of three ranked rows with a 3px proportion rule.
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

**`--bg-secondary` survives as "sunk".** The two-plane rule would retire it, but
it has ~100 consumers and collapsing them all onto canvas in one pass could not
be verified surface by surface. It now holds the sunk value rather than a third
warm tint. Worth a dedicated pass.

**The register's abbreviations are derived, not authored.** §5 of the repo patch
asks for a fixed abbreviation table. Rather than author 66 new strings, the
label uses the existing `data/scripture/book-names-en.json` short forms, keeping
the full name where it is already five characters or fewer so that ACTS, MARK
and JOHN are not clipped to ACT, MAR and JOH for no width at all.

## Pre-existing bug found on the way

Cold-starting a library rebuilds the SQLite projection, and the rebuild
validates every connection anchor. Two anchor shapes in the store fail that
validation:

- 62 anchors carry `selection_shape`, a field **no code in `src/` writes or
  accepts** — it was removed without a migration.
- 20 anchors carry `render_locator`, the v1 shape
  (`src/core/annotations/index.ts:48`), which the newer canonical-token
  validator (`src/core/annotations/backbone-token-anchor.ts:97`) rejects.

The result is `"Canonical token anchor must contain only its passage and exact
selector"` and a refused startup. It stays hidden while an instance is already
running, because the projection is only re-derived on a cold start. This needs
an anchor migration; it is unrelated to the redesign.

## Running it

The QA instance uses its own Electron profile and a **copy** of the library, so
it never touches `~/Desktop/Test`:

```bash
npm run build && npm run build:renderer
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron dist/electron/main.cjs \
  --remote-debugging-port=9222 --user-data-dir=/Users/jonnyroyal/dev/.quire-qa/profile
```

Screenshots land in `docs/ui-audit/quire/`.
