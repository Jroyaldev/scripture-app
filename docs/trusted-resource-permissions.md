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

## Deferred work

- marks for any source beyond the three approved above;
- publisher artwork and cover thumbnails;
- article/commentary descriptions, excerpts, or bodies;
- embedded playback or remote thumbnails;
- automated full-catalog crawling or metadata generation;
- background refresh or runtime network access; and
- any Shepherdly delivery UI before receiver, target picker, transport,
  deduplication, and receipt contracts exist.
