# TASK D5: Trusted-resource foundation and Living Margin cards

STATUS: COMPLETE — the bounded local-manifest milestone is integrated on Smart Shapes.

## Objective

Add a source-neutral, passage-evidence-only resource foundation without
importing the old desktop renderer, crawling publishers, storing article
bodies, or creating an autonomous write/network path.

## Landed

- Restored the pure Working Preacher normalizer/ranker with strict public
  record handling, English/Spanish title parsing, discontinuous and
  cross-chapter coordinates, Backbone validation, translation-free `bref:v1`
  output, and deterministic passage ranking.
- Added strict V1 trusted-resource manifest, record, query, refusal, and ranked
  result contracts. Unknown keys/versions, non-official URLs, token anchors,
  impossible coordinates, unsupported capabilities, and duplicate IDs refuse.
- Added read-only host loading from
  `.artifacts/resources/<source>/manifest.json` with bundled
  `data/resources/<source>/manifest.json` fallback. A present invalid installed
  manifest refuses instead of silently falling back.
- Added sender-bound typed query/open IPC. Ranking uses only exact passage,
  overlap, and same-chapter evidence; score ties use stable source/resource IDs.
  Opening a link requires the exact validated manifest record plus a closed
  official-host allowlist.
- Added a Living Margin Overview group with one featured Masthead · Bold card
  and at most two compact cards. It uses source names, controlled color,
  factual metadata, and one outbound-link action only.
- Added small reviewed-sample manifests for Working Preacher, BibleProject,
  and The Gospel Coalition. None claims complete-catalog coverage.
- Added and validated `shepherdly.resource-node` V2 for an external trusted
  resource while retaining V1 entity-node compatibility. No Save/send control
  is exposed before Shepherdly has a receiver, target picker, transport,
  deduplication, and receipt path.

## Verification

- Focused resource/Shepherdly/desktop contract tests: 15/15.
- Full suite: 744 total, 715 passed, 29 expected Electron-ABI skips, 0 failed.
- `npm run lint`, Electron build, renderer build, and `git diff --check`: pass.

## Guardrails

- No runtime resource network requests or background refresh.
- No publisher bodies, descriptions, logos, artwork, remote media, or embeds.
- No autonomous Substrate writes.
- Installed-invalid means typed refusal, never quiet bundled fallback.
