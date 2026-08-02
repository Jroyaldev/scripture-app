# Trusted resource permissions boundary

Reviewed: 2026-07-20
Mark approval recorded: 2026-07-26 (three sources), 2026-07-27 (Enter the Bible, Naked Bible), 2026-07-29 (Spoken Gospel)

## The 2026-07-30 decision — marks are no longer gated on being asked

**The maintainer decided on 2026-07-30 that the five sources on the public-feed
footing may carry their real marks.** In his words: *"were moving past the
permission doc for brand; well get approval later or accept takedowns but we
wont stall."*

The rule this replaces was written into this file on 2026-07-29 and is quoted
below in "The second footing": *"These sources take generic treatment — their
name in type, no mark — because no mark is approved for any of them."* That
sentence is superseded. It is left standing where it was written, with a
pointer here, because a boundary document that edits its own history is worth
less than one that shows its working.

The reasoning, which is the same reasoning the second footing already rests on:
this project operates the way a podcast client operates over publicly offered
RSS. A publisher's own mark, drawn at the size of a signature beside their own
episode, on the ground their artwork was drawn for, is what every podcast
client on the machine already does with the artwork the same feed serves. The
standing policy is unchanged and is what makes this defensible rather than
merely convenient:

- **honorary permission is sought before any public listing**, from every
  publisher, and the outreach backlog is the list of the unasked;
- **a takedown is honoured immediately**, per source — the per-source gate below
  is what keeps that a one-line change rather than a hunt;
- **the granted-vs-unasked segmentation stays recorded and accurate**, in the
  docs and in the code, because it is what makes the later approval round
  possible at all. It is not weakened by this decision; it is the reason this
  decision can be taken without losing the thread.

Two things follow in the tree, and both are deliberately visible to `grep`:

1. `--resource-mark` still names only the six publisher-granted sources.
   The one public-feed source that gained artwork on this pass took a second
   property, `--resource-device`, because that artwork stands BESIDE the show's
   name rather than in place of it (see the brand inventory for why).
   `tests/trusted-resource-permissions.test.ts` holds each list against its own
   footing, in two named constants — `ALL_APPROVED_MARK_SOURCES` and
   `DEVICE_SOURCES_PUBLIC_FEED` — so the two footings cannot be read off one
   list, and a source cannot drift from one to the other unnoticed.
2. Four of the five still show their name in type, and **that is now an
   artwork finding rather than a permission one**: Premier's lockup is stacked
   colour art that cannot be read at 26px, 1517's numeral is a fifth of its own
   roundel's height, the Listener's wordmark ships with a grey plate baked into
   its pixels, and Radically Christian's drop is the same oxblood as the ground
   it would sit on. Every one of those four files was fetched from the
   publisher, is staged in `src/renderer/assets/brand/pending/`, and is
   recorded with its measurement in
   `docs/trusted-resource-brand-inventory.md`.

Nothing else in this document moves. The audio, transcript, artwork-storage and
runtime-fetch boundaries are untouched by this decision, which is about marks
and only marks.

This is a product-engineering boundary, not a grant of rights or a substitute
for legal review. Re-check the live publisher terms before expanding any source
beyond the capabilities recorded in its versioned manifest.

`docs/trusted-resource-brand-inventory.md` is the stock-take that sits beside
this file, added 2026-07-30: which publishers have an approved mark and which
are colour-only, whose reverse needs a dark field, whose accent was hand-picked
and why, what each palette measures against its own ground, and what asset
would close each gap. That file records state and asks questions; **this file
is what says what may be shown.**

## Approved sources

Marks are approved for the sources listed here, and for no others:

| Source | Mark | Brand surface |
|---|---|---|
| Working Preacher | `wp-stacked-white.svg` | `#9D2235` |
| BibleProject | `bibleproject-lockup-white.svg` | `#00B3E5` |
| The Gospel Coalition | `tgc-mark-wht.svg` | `#79AE4A` |
| Enter the Bible | `etb-main-logo-colour.svg` | `#FED141` |
| Naked Bible Podcast | `naked-bible-emblem-white.png` | `#2F3437` |
| Spoken Gospel | `spoken-gospel-lockup-white.png` | `#239948` |

BibleProject's row changed file on 2026-07-30 and did not change grant: it was
`bp-mono-wht.png`, the publisher's own supplied mono-white raster, and it is now
that same mono-white lockup in the publisher's own vector outlines. The supplied
raster is kept at `pending/bibleproject-lockup-white-supplied.png` as the
authority the ink was matched against. Provenance for every file in this table
is recorded in `docs/trusted-resource-brand-inventory.md`.

And on the public-feed footing, by the 2026-07-30 decision above:

| Source | Device | Brand surface |
|---|---|---|
| 5 Minutes in Church History | `ligonier-tree-white.svg` | `#4F645B` |

One source, not five, and the other four are an artwork finding rather than a
permission one — see the decision note at the top and the per-publisher entries
in the brand inventory. 1517's roundel was acquired, staged and then measured
out: the numeral inside it is 20.6% of the mark's own height, which is 3.1px at
the size a chip draws a device.

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

#### The plate at two sizes — amended 2026-07-30

The chapter's episodes are now drawn on one margin surface
(`src/renderer/components/Resources.tsx`) rather than two, and its cards carry
the same plate at a smaller size. This section is amended rather than extended:
**the plate is one object at two sizes**, 26px at the dock's masthead and 16px
on a card, and no fourth crossing is added.

Three things follow, and they are narrower than the dock's terms rather than
looser:

1. **The plate appears on a row only where a mark is approved.** Six of the
   eleven sources have one. The other five take exactly what the second-footing
   section below already prescribes — "their name in type, no mark" — and their
   rows carry no publisher colour at all. Twenty-five rows from eight
   publishers each painting their own colour would be a colour chart rather
   than a margin, and the rule that already governs marks happens to produce
   the right restraint by itself.

   **Amended 2026-07-30 by the decision at the head of this file: seven of the
   eleven now carry a plate**, six with a mark in place of their name and one
   with a device beside it. The restraint the paragraph above was reaching for
   still holds and is now held by the artwork rather than by the permission —
   three sources have no drawable mark, and the rule that a plate exists only
   where artwork does is unchanged.
2. **The accent does not cross onto the card.** `--player-accent` is declared
   for `.resource-card-face` at its DEFAULT value — the app's own gold — so the
   transport face on every card is the app's, not the publisher's. The
   publisher's accent stays where this section put it: the dock, which is one
   episode the reader chose.
3. **The name still stands in the accessibility tree** in both forms, as
   above. On a card the plate IS the identity line, so nothing is added; the
   grey publisher name that used to sit in a row's meta line is what it
   replaces.
4. **The shelf is the plate's own row of chips**, and it takes the same terms
   at chip size: the publisher's colour, their approved mark where there is
   one, and their name set in type where there is not. Added back 2026-07-30
   with the room — the shelf had been deleted by the merge, and with it the
   filter and the route into resource settings. A chip is a filter over the
   room and nothing else: it narrows what is drawn and it never reproduces
   anything.

There is a **third size**, and it leaves the app's window: the artwork handed
to the system's Now Playing panel is the plate at 512px, painted onto a canvas
from the publisher's own colour and their own approved mark, both read off the
live dock. Nothing is fetched to make it — the mark is a file already on this
machine — and a source with no approved mark gets no artwork, which is the same
rule stated once more. The alternative was a remote artwork URL, which is the
request-nobody-pressed this document exists to refuse.

`scripts/qa-podcast-player.mjs` asserts the card's transport face is the app's
family at 20px, that the room exists exactly once per chapter, that nothing
else in the study panel offers to start audio — which is what stops the two
surfaces drifting back into two brand policies for the same episodes — and that
the system artwork is a `data:` image rather than anything on a publisher's
host.

#### The sheet became a column — amended 2026-07-30

The geometry section above is written about a dock whose expanded form was an
overlay: a sheet capped at `min(56vh, 520px)` that opened upward over the study
panel, out of the panel's own reservation, so that opening it moved nothing.
That is superseded, and the permission terms are unchanged by it — this
amendment exists because the sheet is named in this document and a reader of it
should not be sent to a surface that no longer works that way.

**The study column has two residents and exactly one of them is unfolded.**
Opening the player gives it the whole column and folds the Living Margin to a
single line; unfolding the margin folds the player back to its corner. What
this changes for the permissions above is only the SIZE of the surfaces they
govern, and in the direction that matters: the plate stays 26px on a mast that
is now wider, so the publisher's crossing does not grow with the column, and
the fitted accent still lands in exactly three places. The three-crossings rule
is unchanged and a fourth still requires amending this section.

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

  **Made true in the product, 2026-07-30.** Until that build the sentence above
  was aspirational: `transcriptBasis()` and `TRANSCRIPT_UNASKED_SOURCES` were
  referenced from `tests/transcripts.test.ts` and from nothing in `src/`, while
  48% of every moment these surfaces show came from a publisher nobody has
  asked. The basis now travels with the data and reaches the reader in two
  places, both quiet and both counted rather than assumed:

  - `PassageMoment.basis`, attached in `readPassageIndex` from the map above
    rather than read from the artifact — an artifact is a file anything can
    write, and a publisher's footing is a fact about a conversation. The
    Resources room states it once at its foot, counting the shows actually on
    screen.
  - The player says it for the episode in hand, under the episode's own
    masthead and beside the `auto` mark that already says no person wrote these
    words.

  It is one sentence per surface, not a badge per card: the footing is a fact
  about a publisher rather than about an episode, and a notice repeated
  twenty-five times stops being read. `scripts/qa-podcast-player.mjs` asserts
  both are present and that the wording matches the basis the map records.

  **Said in a reader's language — restated 2026-07-30.** The first wording of
  these two sentences reported our outreach backlog: *"3 of these 8 publishers
  gave permission; 5 have not been asked yet"* and *"…from Radically
  Christian's public feed. We have not asked them yet."* Both are true, and
  neither is a fact about the thing the reader is looking at — "we have not
  asked them" is a line from our to-do list printed on a reading surface. What
  this document requires is that the DISTINCTION stay visible, and it does:

  - granted — *"Transcript machine-read from Naked Bible Podcast's audio, with
    their permission."*
  - public feed — *"Transcript machine-read from Radically Christian's public
    feed."*
  - and on the room, over a shelf of both — *"Transcripts machine-read from
    published audio — some with the publisher's permission, some from their
    public feed."*

  A reader can tell which of the two they are looking at, in words about the
  transcript rather than about us. `tests/resources-contract.test.ts` holds
  both halves: that each surface still names a permission and a public feed,
  and that neither says "not been asked" to anybody.

The gate treats both footings alike on purpose — the enforcement is about
whether a source is enabled at all. What is not allowed to blur is the record of
*why* each one is, because the whole list quietly becoming "approved" in
somebody's memory is exactly the failure the rest of this document is built to
prevent.

Nothing else moves. These sources take generic treatment — their name in type,
no mark — because no mark is approved for any of them, and the rule that a mark
ships only for an approved source is unchanged.

> **SUPERSEDED 2026-07-30, on the maintainer's decision.** The paragraph above
> is the rule the head of this file replaces: marks are no longer gated on
> having asked. See "The 2026-07-30 decision" at the top for the wording, the
> reasoning and what still holds — the outreach backlog, the takedown promise,
> and the requirement that this list of five stay a distinct, named list.
> Everything else in this section is current: the footing, the ids, the basis
> map and the two sentences a reader sees are all unchanged by that decision.

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

**30 Minutes in the New Testament (`thirty-minutes-nt`) and The BEMA Podcast
(`bema`) added 2026-08-01**, both on the carried basis the 2026-07-31
flattening established: public feeds published for clients to read, approvals
sought before any public listing, takedowns honoured on request. 30 Minutes is
the New Testament sibling of 40 Minutes in the Old Testament (same hosts, same
libsyn/adbarker delivery); BEMA's 514 sessions are topical, so its manifest
will be thin and its passage coverage comes from transcript extraction, which
is the pipeline's job rather than the title's.

BEMA's audio is served by **fireside.fm**, and the media policy carries the
wildcard `https://*.fireside.fm` alongside the enclosure host itself. The
enclosure names `aphid.fireside.fm` and the file is served from a numbered
shard — `media24.fireside.fm` in the sampled episodes — which is the podbean
situation again: the shards cannot be enumerated, so the policy takes the
domain.

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

## Music — Poor Bishop Hooper, added 2026-08-02

The first source in the app that is sung rather than spoken, and the first
whose material did not arrive through a podcast feed. That difference is the
whole of what this entry has to record, because it is the difference the
maintainer's standing position has to be applied to deliberately rather than
by analogy.

**What a podcast feed is, and why it carried the eight before this.** An RSS
enclosure is a publisher's own distribution mechanism, published in a format
whose entire purpose is that third-party clients fetch and play it. Carrying
those shows is doing the thing the format exists for.

**Poor Bishop Hooper publish no such feed.** Their catalogue is a page on
their own site — 352 tracks across 14 albums, including all 150 psalms as
EveryPsalm — with a player their site draws and a download button per track.
The audio streams from `cdn.prod.website-files.com`, which is where their own
site serves it from, so playback here reaches for exactly the file their own
listen page reaches for and no copy is made. Their site carries a plain "all
rights reserved" and no licence.

**So the footing is the maintainer's standing one, stated rather than
assumed**: the app is not publicly listed, permission is sought before any
public listing, and takedowns are honoured on request. What is different from
the eight podcasts is that no published feed invites third-party playback, so
this source rests on that position alone. It is recorded here so that a later
reader finds a decision rather than a habit — and so that "ask Poor Bishop
Hooper" is a line someone can act on.

**Artwork is NOT taken**, which keeps the Deferred list below true. Their
album covers are referenced nowhere; the Listen room draws type and the app's
own instruments instead, and the catalogue's `cover` field is captured but
unused. Their download links are recorded and likewise undrawn — a download
is a different act from a stream, and this app does not perform it.

## Deferred work

- marks for any source beyond those approved above;
- publisher artwork and cover thumbnails;
- article/commentary descriptions, excerpts, or bodies;
- embedded playback or remote thumbnails;
- automated full-catalog crawling or metadata generation;
- background refresh or runtime network access; and
- any Shepherdly delivery UI before receiver, target picker, transport,
  deduplication, and receipt contracts exist.
