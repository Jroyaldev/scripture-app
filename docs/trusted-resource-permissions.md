# Trusted resource permissions boundary

Reviewed: 2026-07-20

This is a product-engineering boundary, not a grant of rights or a substitute
for legal review. Re-check the live publisher terms before expanding any source
beyond the capabilities recorded in its versioned manifest.

## Shipping boundary

The current resource cards may show only:

- the publisher/source name in referential text;
- Pericope-controlled source-color styling;
- factual catalog metadata such as title, author, date, kind, duration, series,
  language, and explicit Scripture coordinates; and
- one validated outbound link to the publisher's official HTTPS host.

The current runtime must not show or store publisher logos, artwork,
descriptions, article/commentary bodies, excerpts, audio/video, remote media,
or embedded playback. It must not crawl, refresh, or fetch source content at
runtime. Those capabilities require a separate task, a current terms review,
source-specific attribution, and explicit product approval.

## Source review

### Working Preacher

Official review: <https://www.workingpreacher.org/copyright>

- Luther Seminary states that it owns the rights to Working Preacher articles
  and commentaries and requires permission for electronic or print reprints.
- It says posted artwork is generally not free for reuse unless its attribution
  says otherwise.
- Audio/video has a stated CC BY-NC-ND 3.0 license, but playback is outside this
  local-manifest milestone.

Decision: link-only factual cards. No article text, summary/description,
artwork, logo, audio, video, or embed.

### BibleProject

Official reviews:

- <https://help.bibleproject.com/hc/en-us/articles/22547623073687-I-m-building-an-app-Can-I-use-your-content-in-it>
- <https://bibleproject.com/terms/>

BibleProject's app guidance permits links/embeds subject to its rules, including
not uploading/storing its content, not paywalling or directly profiting from it,
and giving production credit. Its terms state that no general trademark or
service-mark license is granted and limit name/logo use to referential fair use
absent a formal written license.

Decision: referential source name plus official link only. Do not use its logo,
artwork, stored content, or embedded playback in this milestone. A future embed
must implement the required nearby credit and product/business-model checks.

### The Gospel Coalition

Official review: <https://www.thegospelcoalition.org/permissions/>

TGC permits certain unaltered online excerpts with a backlink and publicized
video embeds with a backlink, subject to source-specific exceptions and its
stated conditions. It prohibits re-uploading video without permission.

Decision: link-only factual cards. Do not exercise the broader excerpt/embed
permission until a separate feature defines attribution, exceptions, media
hosting, and removal handling.

## Deferred work

- logos and publisher artwork;
- article/commentary descriptions, excerpts, or bodies;
- embedded playback or remote thumbnails;
- automated full-catalog crawling or metadata generation;
- background refresh or runtime network access; and
- any Shepherdly delivery UI before receiver, target picker, transport,
  deduplication, and receipt contracts exist.
