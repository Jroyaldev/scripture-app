# Library cards under the shelf — DECIDED 2026-08-01

The open question from design night ("is the paper look for sure better than
colouring the whole cards?") is settled, refined by two rulings the user gave
while choosing:

1. **The shelf stays as it is.** The question was only ever about the episode
   library underneath it.
2. **Normalization before colour.** The library is a mixed-publisher grid, so
   cards must read as ONE family: normalized WORDS (one type treatment — 2-line
   clamped title, one footing line, constant ink on constant paper) and a
   normalized LOGO (every mark in one optical slot: wide lockups scaled down,
   emblems stood up, so Working Preacher weighs the same as BibleProject).
   Logo on every card per the standing 2026-07-30 ruling.

**Chosen face: the BAND — one height, colour full-bleed.** A publisher-ground
head band at a single fixed height across all eleven, the mark sitting in the
same slot inside it; title and footing come home to the app's paper below.
Rejected: full-colour jacket (900 jackets are a colour chart; words on eleven
grounds), paper-with-plate (publisher presence too small), colophon pip
(quieter than the user wants).

Renders that decided it: scratchpad card-candidates/static.html (three faces at
two densities) and library-static.html (three normalized treatments, mixed
grid). Mark ratios came from styles.css `--resource-mark-ratio` — reuse them
for the slot math; SVG marks have no intrinsic size, so the slot must set
explicit width/height or the marks collapse.
