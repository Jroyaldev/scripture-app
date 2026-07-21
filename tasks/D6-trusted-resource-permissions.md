# TASK D6: Trusted-resource permissions boundary

STATUS: COMPLETE — current official terms were reviewed and the shipped scope remains link-only.

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

## Verification

- Focused permissions/resource contracts: 17/17.
- Full suite: 746 total, 717 passed, 29 expected Electron-ABI skips, 0 failed.
- `npm run lint`, Electron build, renderer build, and `git diff --check`: pass.
