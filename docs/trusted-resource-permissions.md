# Trusted resource permissions boundary

Reviewed: 2026-07-20
Mark approval recorded: 2026-07-26

This is a product-engineering boundary, not a grant of rights or a substitute
for legal review. Re-check the live publisher terms before expanding any source
beyond the capabilities recorded in its versioned manifest.

## Approved sources

Marks are approved for the three sources shipped here, and for no others:

| Source | Mark | Brand surface |
|---|---|---|
| Working Preacher | `wp-stacked-white.svg` | `#9D2235` |
| BibleProject | `bp-mono-wht.png` | `#00B3E5` |
| The Gospel Coalition | `tgc-mark-wht.svg` | `#79AE4A` |

The 2026-07-20 review below records what each publisher *publishes* about reuse.
It was never a finding that these marks could not be shown — only that the
milestone held no approval to show them. Approval for these three was recorded
on 2026-07-26 and the marks now ship.

Approval is per source. A fourth source shows its name in type until it is
approved in its own right, and the renderer enforces that rather than trusting
it: the mark is attached by an explicit per-source rule, never by a default, so
an unapproved source cannot inherit one. Marks ship as bundled local assets in
`src/renderer/assets/brand/`; nothing is fetched from a publisher at runtime.

Because the official marks are the mono/white variants, the card surface under
them stays the publisher's brand colour in all four appearances. A masthead
that re-tinted per theme would put our chrome on their imprint.

## Shipping boundary

The current resource cards may show:

- the approved official mark for an approved source, or the source name in
  referential text for any other;
- the publisher's brand colour as the featured card surface, and a wash of that
  colour on compact rows;
- factual catalog metadata such as title, author, date, kind, duration, series,
  language, and explicit Scripture coordinates; and
- one validated outbound link to the publisher's official HTTPS host.

The current runtime must not show or store publisher artwork, thumbnails,
descriptions, article/commentary bodies, excerpts, audio/video, remote media,
or embedded playback. It must not crawl, refresh, or fetch source content at
runtime. Those capabilities are blocked on a data shape rather than on
approval: the V1 manifest has no artwork or excerpt field, and adding one has
to settle where the asset is stored and how it is removed, because a remote
`src` would put a reader's passage traffic on a publisher's server.

## Source review

### Working Preacher

Official review: <https://www.workingpreacher.org/copyright>

- Luther Seminary states that it owns the rights to Working Preacher articles
  and commentaries and requires permission for electronic or print reprints.
- It says posted artwork is generally not free for reuse unless its attribution
  says otherwise.
- Audio/video has a stated CC BY-NC-ND 3.0 license, but playback is outside this
  local-manifest milestone.

Decision: factual cards carrying the approved Working Preacher mark and one
official link. No article text, summary/description, artwork, audio, video, or
embed. Mark approval recorded 2026-07-26.

### BibleProject

Official reviews:

- <https://help.bibleproject.com/hc/en-us/articles/22547623073687-I-m-building-an-app-Can-I-use-your-content-in-it>
- <https://bibleproject.com/terms/>

BibleProject's app guidance permits links/embeds subject to its rules, including
not uploading/storing its content, not paywalling or directly profiting from it,
and giving production credit. Its terms state that no general trademark or
service-mark license is granted and limit name/logo use to referential fair use
absent a formal written license.

Decision: the approved BibleProject mark plus one official link. Do not use its
artwork, stored content, or embedded playback in this milestone. A future embed
must implement the required nearby credit and product/business-model checks.
Mark approval recorded 2026-07-26; BibleProject's own terms still grant no
general trademark licence, so the mark ships on the recorded approval and the
referential-use reading, not on a claimed licence.

### The Gospel Coalition

Official review: <https://www.thegospelcoalition.org/permissions/>

TGC permits certain unaltered online excerpts with a backlink and publicized
video embeds with a backlink, subject to source-specific exceptions and its
stated conditions. It prohibits re-uploading video without permission.

Decision: factual cards carrying the approved TGC mark and one official link.
Do not exercise the broader excerpt/embed permission until a separate feature
defines attribution, exceptions, media hosting, and removal handling. Mark
approval recorded 2026-07-26.

## Importing

Two importers build manifests from publishers' public WordPress REST
catalogues: `scripts/import-tgc-resources.ts` and
`scripts/import-working-preacher-resources.ts`. Three things about how they
behave, because they are the parts a publisher would care about:

- It runs **offline, by hand**. Nothing in the app fetches a publisher at
  runtime, and D5's no-network guardrail is unchanged. The import produces a
  file; the app only ever reads files.
- It **identifies itself**: `Pericope/0.1 (+https://marktheword.com;
  trusted-resource importer)`. Node sends no user agent and TGC refuses that,
  and the answer to being refused is not to impersonate a browser. A publisher
  reading their logs can see what asked and who to contact.
- It takes **catalogue metadata only** — id, title, link, date, and the
  publisher's own `scripture` terms. No bodies, no excerpts, no media. The
  manifest it writes is validated before it is saved, so an import cannot
  produce a file the app would refuse.

Passage evidence differs by publisher, and the manifest records which was used:

- **TGC** — its `scripture` taxonomy, hierarchical and chapter-level, so a
  record's coordinates are the publisher's own claim rather than something
  parsed out of a title (`publisher-scripture-tag`). Book-level tags become
  whole-book coordinates, which rank last on specificity — correctly, since
  that is exactly how much the tag actually said.
- **Working Preacher commentaries** — parsed from publisher titles
  (`publisher-title`), using the normalizer the C1 prototype validated.
- **Working Preacher podcasts** — an episode titled "Eleventh Sunday after
  Pentecost" names a day, not a passage. The lectionary day the publisher
  assigned carries its readings, and those are passages, so the coordinates come
  from the publisher's own lectionary rather than from our reading of a title
  (`publisher-catalog`).

## Deferred work

- marks for any source beyond the three approved above;
- publisher artwork and cover thumbnails;
- article/commentary descriptions, excerpts, or bodies;
- embedded playback or remote thumbnails;
- automated full-catalog crawling or metadata generation;
- background refresh or runtime network access; and
- any Shepherdly delivery UI before receiver, target picker, transport,
  deduplication, and receipt contracts exist.
