# Trusted resource permissions boundary

Reviewed: 2026-07-20
Mark approval recorded: 2026-07-26 (three sources), 2026-07-27 (Enter the Bible, Naked Bible), 2026-07-29 (Spoken Gospel)

This is a product-engineering boundary, not a grant of rights or a substitute
for legal review. Re-check the live publisher terms before expanding any source
beyond the capabilities recorded in its versioned manifest.

## Approved sources

Marks are approved for the sources listed here, and for no others:

| Source | Mark | Brand surface |
|---|---|---|
| Working Preacher | `wp-stacked-white.svg` | `#9D2235` |
| BibleProject | `bp-mono-wht.png` | `#00B3E5` |
| The Gospel Coalition | `tgc-mark-wht.svg` | `#79AE4A` |
| Enter the Bible | `etb-main-logo-colour.svg` | `#FED141` |
| Naked Bible Podcast | `naked-bible-emblem-white.png` | `#2F3437` |
| Spoken Gospel | `spoken-gospel-lockup-white.png` | `#239948` |

The 2026-07-20 review below records what each publisher *publishes* about reuse.
It was never a finding that these marks could not be shown — only that the
milestone held no approval to show them. Approval was recorded on 2026-07-26 for
the first three and on 2026-07-27 for Enter the Bible and the Naked Bible
Podcast, and the marks now ship.

Three of these ship artwork that needed handling rather than dropping in. Enter
the Bible's logo is built for a light ground — a yellow tile, orange "BIBLE",
black type — so its card is light, the surface is that tile's own yellow, and
the logo ships unmodified. The Naked Bible Podcast publishes a wordmark that is
a single hairline of small caps, illegible at card size; its emblem was lifted
from the 2000px cover art, reversed to one ink, and is locked up with the show's
name, since an emblem alone identifies nobody.

Spoken Gospel presents two identities and the card had to choose one. The show's
cover art is a gold-leaf gradient on navy; the brand's stated colours are a
green, a pale yellow and a cream, with no gold among them. The green takes the
surface, because it is the only one of the three a reversed mark can sit on and
because a gradient of gold leaf resolves to mud at fifteen pixels — gold there
is a texture, and a texture needs room a masthead has not got. So the
publisher's own horizontal lockup, emblem and wordmark together, reversed to one
ink: the same treatment and the same reason as the Naked Bible emblem. The other
two palette colours are not dropped — the cream is the card's ink and the yellow
is its pill — so the card carries the publisher's three colours and none of ours.

Approval is per source. An unapproved source shows its name in type until it is
approved in its own right, and the renderer enforces that rather than trusting
it: the mark is attached by an explicit per-source rule, never by a default, so
an unapproved source cannot inherit one. Marks ship as bundled local assets in
`src/renderer/assets/brand/`; nothing is fetched from a publisher at runtime.

Because the official marks are the mono/white variants, the card surface under
them stays the publisher's brand colour in all four appearances. A masthead
that re-tinted per theme would put our chrome on their imprint.

### The player's surface — added 2026-07-30

The podcast dock used to take the same bargain as the featured card: the whole
380px surface painted `--resource-source`, every piece of ink on it drawn from
`--resource-ink`, in four atmospheres and forced colors. Forty-four conditions,
none of them checked — and the evidence that it did not hold was already in the
stylesheet. An unbranded source drew a `#fff` play glyph on an `#EDE8E0` pill in
two of the four appearances; six independent alphas compounded past 2:1 on at
least one show; the white-at-10% "light on the surface" was invisible on the two
light brand grounds; and a pale-blue card cast a theme-aware black shadow onto
Ink.

**The app owns the player's ground.** The dock is painted from `--bg-float` —
the app's own floating paper — with the app's own text tokens on it, in every
atmosphere. Three things of the publisher's cross onto it, and no fourth may be
added without amending this section:

1. **The plate.** A 26px rounded rectangle at the head of the masthead, filled
   `--resource-source`, carrying either the approved mark or the publisher's
   name set in `--resource-ink`. This is the only place a publisher's colour
   paints a surface in the player, and it exists for a permission reason before
   an aesthetic one: six of the marks are approved REVERSES, drawn for a dark or
   brand field, and a white mark on cream paper is not a quieter mark but no
   mark. Recolouring the artwork to the app's ink is the modification this grant
   forbids; Enter the Bible's is colour artwork besides, which a mask would
   flatten to a silhouette. The plate is the field the artwork was approved
   against, kept at the size of a signature rather than the size of a poster.
   In forced colors the plate carries `forced-color-adjust: none` — the only
   opt-out on this surface — for the same reason, and the stylesheet says so.
2. **One accent**, `--resource-accent`, consumed in exactly three places: the
   play pill, the rail's played fill, and the mark behind a transcript search
   hit. Nowhere else, ever. It is lightness-clamped per atmosphere so it holds
   against the app's paper (see `--accent-fit-*` at `:root`), because contrast
   on our ground is our responsibility and not the publisher's. Hue and chroma
   are untouched, so the colour stays theirs.
3. **The name**, in the accessibility tree, whichever form the plate takes.

Everything else on the dock — every hairline, every hover, every piece of text,
and the ground itself — is the app's. `scripts/qa-podcast-player.mjs` walks all
twelve palettes (eleven sources plus the unregistered fallback) against all four
atmospheres in the running engine and asserts three things: that the dock's
ground is the app's paper and never the brand's, that the plate IS the brand's,
and that the fitted accent clears 4.5:1 against the ground it sits on. A rule
that paints anything else on this surface in a publisher's colour is a
regression, and that tour is what catches it.

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
descriptions, article/commentary bodies, excerpts, or embedded playback. It must not crawl, refresh, or fetch source content at
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

### Spoken Gospel

Granted 2026-07-29. The maintainer reports that the publisher gave permission
directly and stated that their terms of use permit non-commercial use. That is
recorded here as what the publisher said, not as a reading of a published page:
unlike the four sources above, no live terms URL was reviewed for this entry, so
if this source is ever expanded beyond the capabilities below, the terms are the
thing to go and read first.

Decision: factual cards carrying the approved Spoken Gospel mark and one
official link, audio streamed from the publisher's feed host, and machine
transcripts under the grant recorded below. No artwork, no show notes, no
episode descriptions — the feed carries all three and none is imported.

The permission as stated is for non-commercial use, which the current product
is. It is worth writing down plainly that this is the first grant whose scope is
tied to how the product is sold rather than to what the feature does: nothing in
the code can enforce it, and a change in business model would need this
conversation reopened rather than merely re-read.

## Playing audio — amended 2026-07-27

A card may play a source's own audio file, and nothing else about media has
moved. What makes this narrower than the "no audio" it replaces:

- **The publisher declares where its media lives.** A record may carry
  `audioUrl` only if its source declares `mediaHosts`, and the URL must be
  HTTPS on one of them. Permission to publish a link was never permission to
  fetch a file, and the schema now keeps those apart. A source with no
  `mediaHosts` cannot hold audio at all — the manifest refuses to load.
- **Only on press.** The element carries `preload="none"`, so nothing is
  requested until a reader presses play. Without that the app would call the
  publisher's server the moment a card rendered, which would tell them what a
  reader is reading — the same objection that keeps remote artwork out.
- **Unmodified, unstored, un-rehosted.** The publisher's file, streamed from
  the publisher, kept nowhere. No download, no cache, no copy.
- **The link stays.** Play sits beside the outbound verb rather than replacing
  it; the card still says where the episode lives.
- **One element, and it outlives the card.** Amended 2026-07-27: the element
  moved out of the resource card into the app shell, because a card is torn
  down on every study tab, passage and panel close and an episode should not be.
  Nothing about the permission moved with it — same `preload="none"`, same one
  element for the whole app, same single declared host — and one thing was
  added: the dock's stop releases the file (`src` removed, element reloaded)
  rather than leaving a connection idling on a server that is not ours. A test
  holds that exactly one `<audio>` exists in the renderer, so two publishers
  can never play at once.

The renderer's content-security policy names the one approved host rather than
widening to a scheme, so an audio URL that slipped past validation still could
not load.

Approved for the Naked Bible Podcast on 2026-07-27, whose audio is served from
its own domain. TGC's audio sits on a CDN and Working Preacher's behind a player
page; neither is enabled, and each would need its own decision.

Approved for Spoken Gospel on 2026-07-29. Like BibleProject, its pages and its
audio belong to different parties — episodes live on `www.spokengospel.com` and
`www.spokengospelpodcast.com`, and all 295 enclosures are `audio/mpeg` on
`traffic.megaphone.fm`. So the source declares that one media host. Two page
hosts rather than one is not sloppiness: the show moved domains part-way through
its run and the older episodes' links were never rewritten, so allowing only the
current one would break thirty-one episodes' cards.

**`media-src` names `https://*.megaphone.fm`, and this is the first wildcard in
the policy.** It is here because `traffic.megaphone.fm` is a router rather than
a file server: every request 302s to whichever delivery host Megaphone picks at
that moment — `dcs-spotify.megaphone.fm` and `dcs-cached.megaphone.fm` in twelve
sampled episodes, and there is no reason to think those are all of them. CSP
re-checks the redirect target, so naming only the URL we store means every
episode fails to play, which is what happened: `networkState` 3, no source, and
a player saying it could not reach the episode.

Enumerating today's two would be a policy that works until Megaphone adds a
third, and it would fail silently for some episodes and not others. What was
refused before, and is still refused, is widening to a *scheme* — `https:` would
permit any host on the internet. One registrable domain, belonging to the media
host the publisher declared, is a different and much smaller thing. The
narrowest honest statement of where this publisher's audio lives is
`*.megaphone.fm`, because the publisher's own CDN decides the subdomain per
request.

### Every media host, and where it actually goes

The host in an enclosure URL is usually a router, not a file server. These were
measured by following the redirect on sampled episodes from each show, and the
policy is built from the right-hand column — because CSP re-checks the target,
and getting this wrong does not fail at import. It fails much later, as a player
saying it could not reach the episode.

| Declared in the manifest | Actually serves the bytes |
|---|---|
| `nakedbiblepodcast.com` | itself — no redirect |
| `afp-597195-injected.calisto.simplecastaudio.com` | itself — no redirect |
| `traffic.megaphone.fm` | `dcs-spotify.megaphone.fm`, `dcs-cached.megaphone.fm` → **`*.megaphone.fm`** |
| `dts.podtrac.com` | `traffic.libsyn.com` → `content.libsyn.com` → **`*.libsyn.com`** |
| `adbarker.com` | `traffic.libsyn.com` → `content.libsyn.com` → **`*.libsyn.com`** |
| `mcdn.podbean.com` | `s328`/`s332`/`s368`/`s381`.podbean.com → **`*.podbean.com`** |
| `api.substack.com` | `substackcdn.com` |

Three of these need a wildcard and two do not, which is the test to apply to the
next one: name the literal host wherever the redirect is stable, and take the
registrable domain only where the publisher's CDN picks a subdomain per request.
Podbean is the clearest case — four sampled episodes went to four different
numbered shards, so there is nothing to enumerate.

A test requires every wildcard in the policy to have its domain named in this
file, so one cannot be widened quietly.

### BibleProject audio — BUILT, NOT GRANTED

**This capability is wired and must not ship until BibleProject grants it.**

Built on 2026-07-27 at the maintainer's instruction, explicitly ahead of
permission, so that the request can be made against something real rather than a
description. Nothing about it is approved.

It is the first grant where linking and playing point at different parties. The
episode pages are on `bibleproject.com`; all 534 audio enclosures are
`audio/mpeg` on `afp-597195-injected.calisto.simplecastaudio.com`, a Simplecast
CDN. So the source declares that CDN in `mediaHosts`, and the renderer's policy
names it in `media-src` — one host, not a scheme, in both copies of the policy.

What is deliberately *not* claimed by having built it: a public download button
on the episode page shows the publisher intends listeners to have the file. That
is a good fact to bring to the conversation. It is not the conversation.

To withdraw it, if permission is refused or simply not obtained:

1. drop `mediaHosts` from the source in `scripts/import-bibleproject-resources.ts`
   and re-run the importer — records lose `audioUrl`, because the validator
   refuses audio from a source that declares no media host;
2. remove the Simplecast host from `media-src` in **both**
   `scripts/build-renderer.mjs` and `src/renderer/index.html`;
3. delete this section, which a test requires to exist while the host is present.

That test is the point of writing this down. A capability built ahead of
permission is one forgotten conversation away from shipping as though it had
been granted, and the repo should not rely on anyone remembering.

## Transcripts — amended 2026-07-28

The earlier ruling here was that transcripts remain out: indexing a publisher's
transcript URL would be catalogue metadata, but storing or displaying the text
is storing a publisher's body. That reasoning still holds, and it is why this
needed a grant rather than a judgement call.

**BibleProject granted transcripts on 2026-07-28**, on one condition: that the
transcriptions are not mischaracterized. **The Naked Bible Podcast granted the
same day**, whose audio was already approved on 2026-07-27 because it is served
from the publisher's own domain. **Spoken Gospel granted on 2026-07-29**, under
the non-commercial terms recorded in its source review above. Requests to
Working Preacher, The Gospel Coalition and Enter the Bible are outstanding, and
until each is answered this capability covers exactly those three.

Naked Bible matters beyond its own catalogue. Everything built on transcripts so
far — the reference extraction, the notion of how much of an episode a passage
is given — was measured against one publisher whose episodes range widely across
scripture. Naked Bible works the opposite way, an episode at a time through a
passage, and is the first corpus able to show whether any of it generalises or
was only ever a description of BibleProject.

### The second footing — public feed, added 2026-07-29

Five sources were added on a different basis, and the difference is the point of
writing this down. **They have not been asked.**

| Source | id in code | Feed |
|---|---|---|
| Ask N.T. Wright Anything | `ask-nt-wright` | `feeds.megaphone.fm/NSR7466770103` |
| 5 Minutes in Church History | `five-minutes-church-history` | `rss.libsyn.com/shows/116817/…` |
| 40 Minutes in the Old Testament | `forty-minutes-ot` | `rss.libsyn.com/shows/62612/…` |
| The Listener's Bible Commentary | `listeners-commentary` | `feed.podbean.com/listenerscommentary/feed.xml` |
| Radically Christian | `radically-christian` | `api.substack.com/feed/podcast/2966200.rss` |

The id column is not decoration: the test that holds this file and the code
together matches on the identifier, so a show named here only in prose would
read as undisclosed.

The maintainer's position, recorded as theirs: a podcast RSS feed is published
so that clients may consume it, the catalogue metadata taken from it is not the
publisher's copyrightable work, and machine transcription is what every large
podcast client already offers. On that reading this is the ordinary use a feed
is for, and it proceeds without waiting.

What that position does **not** say, and what this file exists to keep saying:

- **It is not permission.** Permission is to be sought from each of these
  publishers before any public listing, and honoured if refused.
- **A takedown request is to be honoured on request**, per source, and the
  per-source gate below is what makes that a one-line change rather than a hunt.
- **The distinction must stay visible.** `TRANSCRIPT_SOURCES` records a basis
  per id — `publisher-granted` or `public-feed` — and `TRANSCRIPT_UNASKED_SOURCES`
  enumerates the second. That list is the agenda for the conversations still
  owed; an empty one is the condition for a public listing. A test requires
  every id to carry a basis, so a new source cannot arrive without stating which
  footing it is on.

The gate treats both footings alike on purpose — the enforcement is about
whether a source is enabled at all. What is not allowed to blur is the record of
*why* each one is, because the whole list quietly becoming "approved" in
somebody's memory is exactly the failure the rest of this document is built to
prevent.

Nothing else moves. These sources take generic treatment — their name in type,
no mark — because no mark is approved for any of them, and the rule that a mark
ships only for an approved source is unchanged.

### What the capability is

What makes it narrower than "transcripts are allowed":

- **Per source, enforced on data rather than intent.**
  `TRANSCRIPT_SOURCES` in `src/core/transcripts.ts` names every enabled
  publisher, and a transcript whose record belongs to any other source is
  refused before its file is read. A source that is not on the list cannot be
  displayed by forgetting a check, because there is nothing to forget — the
  record id itself is refused.
- **Machine transcripts declare themselves.** Every record carries
  `generated: true` and the model that produced it, and the loader refuses any
  file that omits the claim. The panel marks the transcript `auto`, reading
  "Automatically transcribed by Pericope" — the attribution names us rather than
  a model checkpoint, because who a reader can hold responsible for a wrong word
  is the useful half of provenance, and a version string in the reading area was
  a debugging artefact rather than a disclosure. That is the granted condition
  made structural: generated text cannot pass for something a person wrote. Some
  of these words are wrong, which is precisely why the marker is not decoration.
- **Ours, not theirs.** These are machine transcripts of the publisher's audio,
  not the publisher's own transcript text. BibleProject publishes official
  transcripts for roughly half its catalogue; those are a separate artifact and
  this grant is not a licence to copy them.
- **Their own store, outside the manifest.** Transcripts live in
  `.artifacts/transcripts/`, keyed by record id. The trusted-resource manifest
  stays a link-only catalogue with no body-shaped field in it, so the schema
  that refuses `body`, `description` and `excerpt` is unchanged and its tests
  pass untouched.
- **No fetching.** Nothing here reaches a publisher's server. Transcripts are
  produced by an explicitly invoked pipeline (`pipelines/transcription/`) and
  read from local disk.

The separate store is the honest weak point: it does not inherit `hasOnlyKeys`,
host gating or provenance validation, so it carries its own fail-closed reader
instead. That was the right call while the question was open. Now that one
source is granted and others are pending, whether transcripts should become a
declared manifest capability — the way `mediaHosts` made audio one — is worth
revisiting rather than left settled by default.

## Importing

Four importers build manifests from publishers' public WordPress REST
catalogues — `import-tgc-resources.ts`, `import-working-preacher-resources.ts`,
`import-enter-the-bible-resources.ts` and `import-naked-bible-resources.ts`, all
in `scripts/`. Three things about how they behave, because they are the parts a
publisher would care about:

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
- **Enter the Bible** — each passage record carries a `verse` field the
  publisher fills in (`publisher-scripture-tag`). Their audio, video, glossary,
  map and time-period records are tagged by book alone and are not imported:
  whole-book coordinates rank below every chapter-level card and would never
  surface.
- **Naked Bible** — parsed from episode titles (`publisher-title`), which name
  the passage the episode works through. Roughly half the catalogue names no
  passage — Q&As, interviews, tributes — and those are omitted rather than
  guessed at.

## Deferred work

- marks for any source beyond those approved above;
- publisher artwork and cover thumbnails;
- article/commentary descriptions, excerpts, or bodies;
- embedded playback or remote thumbnails;
- automated full-catalog crawling or metadata generation;
- background refresh or runtime network access; and
- any Shepherdly delivery UI before receiver, target picker, transport,
  deduplication, and receipt contracts exist.
