# TASK D6: Trusted-resource permissions boundary

STATUS: COMPLETE — current official terms were reviewed. AMENDED 2026-07-26:
the product owner recorded approval for the three shipped sources' official
marks, so the cards now carry the mark plus one outbound link. Artwork,
excerpts, and embeds stay out, and the reason changed: it is a data-shape
question now, not an approval one.

## Objective

Verify source and brand terms before enabling logos, artwork, playback,
descriptions, or broader metadata, and turn the conservative result into a
testable product boundary.

## Landed

- Recorded the 2026-07-20 review of official Working Preacher, BibleProject,
  and The Gospel Coalition terms in `docs/trusted-resource-permissions.md`.
- Kept every manifest at `outbound-link-only` / `reviewed-sample`.
- Locked the current cards to source names, controlled source color, factual
  metadata, and exact official-host links.
- Added a contract test refusing media/body/embed fields and proving the
  renderer has no image, embed, playback, Save, or runtime-fetch path in the
  trusted-resource block.

## Decision

No terms review justified broadening this milestone. Working Preacher requires
permission for article/commentary reuse and generally restricts artwork;
BibleProject permits conditional app linking/embedding but grants no general
trademark license; TGC permits conditional excerpts/embeds. Pericope uses the
strict common denominator until each broader capability is separately designed
and approved.

### Amendment, 2026-07-26

The 2026-07-20 decision conflated two things: what a publisher's public terms
say, and whether this product had approval on file. Marks were held back for
the second reason and the doc read as though it were the first. Approval for
Working Preacher, BibleProject, and The Gospel Coalition is now recorded, and
the cards carry their official mono/white marks on the publisher's brand
surface, served from `src/renderer/assets/brand/`.

The approval is per source and the renderer enforces that: `--resource-mark`
defaults to `none` and each mark is attached by a rule naming its own source,
so a fourth source shows its name in type until it is approved too.

## Verification

- Focused permissions/resource contracts: 17/17.
- Full suite: 746 total, 717 passed, 29 expected Electron-ABI skips, 0 failed.
- `npm run lint`, Electron build, renderer build, and `git diff --check`: pass.
