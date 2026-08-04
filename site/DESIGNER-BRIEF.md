# Pericope — landing page brief

For the designer. Everything you need to make the page, and the reasoning
behind the parts that are easy to get subtly wrong.

Live domain: **marktheword.com**. Current page is in this folder (`index.html`,
`styles.css`, `script.js`) — treat it as a first draft to replace, not a
constraint. Product screenshots are in `assets/`, regenerated from the app's own
QA captures. Brand marks are in `assets/brand/`.

---

## 1. What Pericope is

**A desktop reading room for people who read the Bible slowly and mean it.**

Not a Bible app. Not a study suite. A room. You open it and there is a chapter,
set in a real serif, at a real reading measure, on warm paper — and nothing else
until you want something. When you do want something, it is already beside you.

Six places to be: **Read · Write · Notes · Search · Listen · Settings.**

It is macOS, in early access. It is made by Shepherdly, the people behind
churchdesk.app.

**One sentence to hold onto:** *Everything in your library that has something to
say about this passage, arriving quietly, only when you ask.*

---

## 2. Who this is for

Not "Bible app users." A narrower and better-defined person:

- Preachers and teachers preparing weekly, who currently have eleven tabs open.
- Seminarians and lay readers who want Greek and Hebrew without a paywall or a
  1998 interface.
- People who already listen to BibleProject and BEMA and Spoken Gospel and
  already own the Poor Bishop Hooper catalogue — and who have never once been
  able to ask *"what did any of them say about the chapter I'm in?"*
- People who like Things, Bear, Craft, Arc. Who notice type. Who will pay for
  quiet.

They are not looking for more content. They are drowning in content. They are
looking for **a place to put it and a way to find it again.**

That's the emotional promise: *relief*, not abundance.

---

## 3. The taste target

The reference stack the founder named, and what each one is actually for:

| Reference | What we take from it |
|---|---|
| **BibleProject** | Warmth without cheapness. Illustration that serves an idea. Colour that is confident and never garish. Deeply *unembarrassed* to be about the Bible. |
| **Poor Bishop Hooper** | Restraint as reverence. Hand-made texture. Nothing oversold. An entire catalogue with almost no marketing voice — and it works. |
| **Apple (the good years)** | Product photography as the argument. Enormous whitespace. One idea per screen. Type doing the heavy lifting. Motion that explains rather than entertains. |
| **Linear / Arc / Things** | The craft floor for software marketing in 2026. Real product, shown large, shown honestly. |

**Where we must not land:** megachurch conference deck. Stock photo of hands on
an open Bible. Gradient-mesh SaaS. Anything with a 3D floating iPhone. Anything
that says "AI-powered."

**The test:** if a designer at Apple and a worship leader at a 60-person church
both looked at this page, both should think *"that's for me."* That's a narrow
target and it is the whole job.

---

## 4. The five things the page must land

In priority order. Everything else is support.

### 4.1 — The reading canvas is the hero

The single strongest asset we have is a screenshot of the app reading. Warm
paper, Source Serif, a quiet verse-number gutter, generous measure, one gold
mark where the reader is. It looks like a book that happens to be software.

Show it **enormous**. Above the fold. Barely cropped. Let it carry the first
screen almost alone.

### 4.2 — The margin that reads with you

Beside the text is **the Living Margin** — a study panel that follows what you
are reading. It knows the chapter you are in, the verses in view, and the range
you have selected, and it changes what it offers accordingly. Cross-references,
the original languages, your own notes, people and places — four lenses, your
choice, and it doesn't reset just because you turned the page.

The design idea worth communicating: **the tools appear at the moment they
become useful, and are silent before that.**

### 4.3 — Everything anyone taught about this chapter, with a timestamp

This is the feature nobody else has, and it is the one most likely to make
someone actually download the app.

Pericope has listened to thousands of hours of teaching — BibleProject, BEMA,
Spoken Gospel, the Naked Bible Podcast, 40 Minutes in the Old Testament, Ask
N.T. Wright Anything, the Listener's Commentary and more — and indexed **the
moment each one is talking about the passage you are reading.** Not "this
episode is about Genesis." *This minute.*

(Each source is individually cleared before it can be indexed at all, and every
moment carries the basis it was cleared on. Say "with permission" only in
general terms — the specifics are per-publisher and live in the permissions
doc.)

Open Genesis 1 and there are **922 moments** waiting. The median chapter has 18.
You can press one and hear it, or take a **walk** — stop by stop through what
different teachers said about the same passage.

For the page: this is a demo, not a bullet. It wants a small piece of real
interaction, or at minimum a sequence of three screenshots that tell the story
of pressing one and hearing it.

### 4.4 — The library is yours, on your machine

Your notes are plain Markdown files in one folder you can move. Your highlights,
connections and marks are yours. Nothing syncs to us because there is no us to
sync to. No account is required to read.

This is a *conviction*, and convictions read best short and flat. Do not
over-explain it. One line, one piece of evidence, move on.

### 4.5 — Listen is a real room, not a feature

The app has a full listening room: the podcasts above, plus fifteen Poor Bishop
Hooper records — **EveryPsalm**, a song a week for nearly three years from Psalm
1 to Psalm 150, alongside Hymns I–IV, As Foretold, The Serpent & The Seed,
Firstborn, Golgotha. Continue listening, playlists, and a player that keeps your
place across quits.

And the seed that ties the whole product together: **build a playlist from a
passage.** Type "Psalm 23" and get back the psalm sung, and the sermons on it,
from five different publishers, on one list.

Every record page in the app is coloured by its own artwork — the whole window,
sidebar included, takes the album's colour. That is a genuinely beautiful thing
on screen and it screenshots well. Use it.

---

## 5. What NOT to do with the copy

The founder's instruction, kept verbatim in spirit: **no naive, unrestrained
copy, and don't sell the technicals.**

**Never write:**

- "Revolutionary." "Powerful." "Unleash." "Supercharge your study."
- "AI-powered anything." (There is intelligence in the product. It is bounded,
  optional, and never writes to your library. It is not the pitch.)
- Feature lists with checkmarks.
- Scripture used as a marketing hook. One verse in the footer is the entire
  budget, and there is already one there.
- Anything that implies this replaces church, a pastor, or study itself.
- Urgency theatre. No countdowns, no "spots left," no fake scarcity.

**The register to write in:** plain, concrete, quietly confident. Short
sentences. Real nouns. Say the specific thing rather than the impressive thing.

> **Don't:** "Unlock deeper study with our powerful cross-reference engine."
> **Do:** "Every cross-reference OpenBible has, and it says where each one came
> from."

> **Don't:** "Seamlessly integrated audio experience."
> **Do:** "Genesis 1 has 922 moments in it. Press one."

> **Don't:** "Your data, secured."
> **Do:** "Your notes are Markdown files in a folder. Move the folder."

Headlines can be short and declarative. Body copy should be a person talking.
If a sentence could appear on any other product's site, cut it.

---

## 6. The design language you're inheriting

The app has a real, documented visual system. **The page should feel like the
app** — a reader should recognise the product before the first screenshot
loads. Pull from these; you do not have to obey them, but deviating should be a
decision.

**Type**
- **Source Serif 4** — Scripture, and anything that *is* the text. Also carries
  Greek and Hebrew, so the same face renders all three.
- **Instrument Sans** — interface, explanation, controls.
- **Geist Mono** — numerals, counts, timestamps, coordinates, provenance.

That three-way split is a real principle in the product: *serif is the text,
sans explains it, mono measures it.* If the page honours that, it will feel
native without trying.

**Colour**
- **Gold is a verb.** In the app, gold means current, selected, focused,
  actionable. It is never decoration. Please keep this — a page with gold
  sprinkled decoratively will read as a different product.
- Warm neutral grounds. Paper, not white.
- Publisher and record colours (the deep navy of Spoken Gospel, EveryPsalm's
  terracotta) are *data*, and they are gorgeous. They can carry sections.

**Geometry & depth**
- Controls 6px, panels 12px, large cards 20px. Pills only where the shape means
  "compact state."
- **Elevation is scarce.** Most relationships are spacing, a material shift, or
  one hairline. Shadows are for things that genuinely float.
- **Motion explains.** ~150ms is the house default. Motion may show origin,
  continuity, or state change. It does not decorate idle surfaces. Please
  respect `prefers-reduced-motion` — the app does, thoroughly.

**Atmospheres** — the app ships four: **Paper** (warm day), **Ink** (low-glare
night), **Glass** (translucent daylight), **Candlelight** (warm dark glass). The
picker in-app is called *Reading atmosphere*, not Theme, and its explanation is
**"Material changes. Meaning does not."**

That is a good line and a good section. The current page already has an
atmosphere switcher that recolours a screenshot live; the idea is worth keeping
even if the execution changes.

---

## 7. Suggested page architecture

A starting shape, not a specification. Each section listed with *the one thing
it must prove.*

1. **Hero** — *This is beautiful and it is for reading.* Wordmark, one line, one
   sub-line, one CTA, and the reading canvas very large. Resist a second idea
   here.
2. **The canvas** — *The text is treated properly.* Type, measure, atmosphere.
   Detail crops: a verse-number gutter, a highlight, the gold focus rail.
3. **The margin** — *It reads with you.* Best told as a small sequence: select a
   verse → the margin changes. Motion earns its place here.
4. **Taught here** — *Nobody else can do this.* The 922 moments. Publisher
   plates in their own brand colours. A timestamp. A play button. This section
   should be the visual peak of the page.
5. **Listen** — *There is a whole second room.* Album art wall, the record-colour
   effect, "build a playlist from a passage."
6. **Languages & sources** — *It is honest.* Greek and Hebrew a word away;
   OpenBible cross-references; TIPNR people and places; Pleiades ancient
   records — each one named and credited. Honesty is the aesthetic here; make
   provenance look like craft rather than like a legal footer.
7. **Convictions** — *It is built like a library, not a feed.* Nothing writes
   itself. Local files. Rebuildable. Three short claims, flat, no icons if
   possible.
8. **Atmospheres** — *Same words, different light.* Interactive if you can.
9. **CTA / early access** — *Get in.* macOS, early access, one email, one
   promise: "One email when it's ready." Keep that promise on the page; it is
   currently there and it is the right tone.

**Mobile matters more than usual.** This is a desktop app, but it will be shared
in group chats and from pulpits. The phone version cannot be the desktop page
squeezed — the screenshots need their own crops.

---

## 8. Assets you have, and what to ask for

**Have now**
- Real product screenshots in `assets/` (from `docs/ui-audit/` — the app's own
  automated capture tours, so they are true renders, never mockups). Available
  in all four atmospheres for most surfaces.
- Brand marks in `assets/brand/` — lockup, mark, favicon, apple-touch.
- Publisher artwork and colours already measured and documented.

**Worth asking for**
- Any specific screenshot, at any window size, in any atmosphere — these are
  generated on demand, so ask rather than mocking one up.
- Short screen recordings of the margin responding, a playlist being seeded, or
  the record-colour transition. These are the three motions worth filming.
- The EveryPsalm and Hymns cover art at full resolution.

**Do not** fabricate UI that doesn't exist. If the page needs a state the app
doesn't have, say so and it can be built — a lander promising a screen that
isn't there is a support problem on day one.

---

## 9. Context: how it's actually built

**This section is background so your instincts are right. It is not copy, and
almost none of it should appear on the page.** It is here because knowing a
thing is genuinely well-made changes how you design for it.

- **Local-first, literally.** Notes are plain Markdown files; the Markdown file
  is authoritative, always. The database is a *rebuildable view* — delete it and
  it reconstructs identically from your files. There is no server, no account,
  no telemetry.
- **Nothing writes to your library without you.** It's an enforced architectural
  rule, not a setting: system, AI and plugins are structurally incapable of
  writing your data. Every write is an explicit human action.
- **References are translation-free.** A note anchored to a verse stays anchored
  when you change translation, because anchors store position in a canonical
  backbone rather than in any one text. Changing translation is a *render
  request.*
- **Word-level alignment.** Translations are aligned to the original-language
  spine word by word, which is what makes "this English word, that Greek word"
  reliable rather than approximate.
- **Publisher permissions are enforced in code.** Every logo, colour, transcript
  and audio grant is recorded in a permissions document, and a test fails the
  build if the code uses something the document doesn't grant. Nothing appears
  in the app on a "probably fine" basis.
- **Transcripts are indexed to the second.** That's where the 922 moments come
  from — real transcription, real timestamps, permission-gated per publisher.
- **Contrast is measured, not eyeballed.** Every colour pairing in the app is
  measured in the running browser against a 4.5:1 floor by an automated tour
  that fails the build. The design system has a written rule for it, and
  publisher brand colours are re-measured when they change.
- **The UI is verified by automated tours** that drive the real app and take the
  screenshots you'll be using. That's why the assets are trustworthy.

**The one part of this worth surfacing to a reader**, and only briefly, is
section 4.4: your files, your folder, your machine. Everything else in this
list is why the product feels the way it does — not something to argue about on
a page.

---

## 10. Constraints and truths

- **Platform:** macOS, early access. Don't imply Windows, iOS or web.
- **Price:** not decided. Don't imply free-forever or show a price.
- **The CTA** is currently a `mailto:` placeholder and needs a real list
  provider. Design for a single email field and a one-line promise.
- **Attribution:** the footer must keep the Shepherdly line and the
  churchdesk.app link.
- **Publisher logos** may only appear where the permissions doc grants them. If
  the page uses publisher marks — and it probably should, because that wall of
  logos *is* the credibility — check the list first. Some grant a mark, some
  only their name in type. That distinction is real and enforced.
- **Accessibility is not optional.** The product holds itself to a measured
  contrast floor, complete keyboard paths, and reduced-motion support. The page
  that sells it cannot be worse than the thing it sells.

---

## 11. The feeling to aim for

Someone lands on this page from a link a friend sent. They don't read it. They
scroll, slowly, the way you scroll something that is nice to look at. Somewhere
around the third screen they stop and go back up to look at the type again.

By the bottom they have not learned a feature list. They have formed one
impression: **someone made this carefully, and they made it for me.**

Then they leave their email — not because the page asked well, but because they
want to be in the room.

---

*Questions, more screenshots, a state you need built: ask. Everything on this
page can be generated from the real app.*
