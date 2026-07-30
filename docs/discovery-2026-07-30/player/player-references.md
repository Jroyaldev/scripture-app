# Passages and references between the player and the reading experience

Read-only discovery in `/Users/jonnyroyal/dev/scripture-app-quire` (worktree, branch
`codex/quire-redesign`). Nothing was built, run, or written in the repo. Line numbers for
`src/renderer/styles.css` are against the working-tree copy as of this pass — another agent
was editing that file concurrently and it moved ~40 lines during the sweep; `player.css`
and every `.tsx`/`.ts` citation were stable.

Live corpus, measured from `~/ScriptureLibrary/.artifacts/`:

| | |
|---|---|
| chapters with moments | 1,170 |
| moments | 41,426 |
| distinct episodes | 3,208 |
| moments with a playable `audioUrl` | 41,426 (100%) |
| relations | crossref 18,091 · subject 10,667 · allusion 7,590 · mention 5,078 |
| moments per chapter | median 18, max 922 (GEN 1), then GEN 3 808, GEN 2 591, MAT 5 398, ROM 8 383 |
| moments carrying a verse range | 31,285 of 41,426 (75.5%) |
| references per episode | min 1, median 12, p90 25, max 64 |
| subjects per episode | median 2, max 28 |
| transcript files | 3,521 (313 have no reference file) |
| reference files | 3,208 (all have a transcript) |

---

## 1. The moment flow map

### 1a. Passage → moments (reading side)

**Artifact.** `~/ScriptureLibrary/.artifacts/passage-index.json`, path built at
`src/host/passage-index-loader.ts:21-23`.

**Validation and the grant gate.** `src/core/passage-index.ts:175-202` (`readPassageIndex`).
Fails closed on schema (`:178`) and on `generated !== true` (`:179`). Per-moment shape check
at `:151-164`, which requires `audioUrl` to be an `https://` string (`:162`) — the comment at
`:160-161` says the reason is that an unpressable row is worse than no row. Every moment is
then re-filtered through `isTranscriptEnabledSource` at `:190`, and sorted longest-first at
`:192` rather than trusted from the file.

**Cache.** `src/host/passage-index-loader.ts:19` holds one entry keyed on
`{libraryPath, mtimeMs, size}`. The stat is taken at `:41-46`, compared at `:47-52`, and the
parse result cached at `:56`. The comment at `:33-39` is the record of the fix: keying on
`libraryPath` alone meant a rebuilt index was never re-read for the life of the process — "a
chapter with seventy-one moments reported none". That is the Deuteronomy 32 incident, and the
loader-side half of it is fixed.

`resetPassageIndex()` is exported at `src/host/passage-index-loader.ts:26` and **is called from
nowhere in `src/`**. The stat check makes it unnecessary; it is dead.

**Query.** `momentsFor` at `src/core/passage-index.ts:211-243`. Chapter-granular by design
(`:204-210`). When a verse is supplied it *bands* rather than filters (`:219-235`) into
`on` / `whole` / `chapter` (`proximityOf`, `:110-119`), then orders by distance and length
inside the non-`on` bands. Mutes are applied at `:236-242` using the same `sourceId` /
`sourceId:kind` rule shape the resource query uses.

**IPC.** `src/electron/main.ts:2492-2503`, handler `passage-moments`, registered as a runtime
*read*. Mutes are read from the main-process store at `:2502`, not taken from the caller.
Bridge: `src/electron/preload.ts:147-148`. Renderer type: `src/renderer/api.ts:127`.

**The only renderer consumer.** `src/renderer/components/LivingMargin.tsx:3813-3820`. State at
`:3442`. Re-fetched on `[book, chapter, focusVerse, trustedResourceFilterVersion]`.
`focusVerse` = `pinnedRange?.start ?? nearVerse ?? null` (`:3803`).

**The one component that renders them.** `TaughtHereBlock`,
`src/renderer/components/LivingMargin.tsx:411-517`. Mounted three times in the source —
`:4607` (chapter scope), `:4738` (ambient reading), `:4872` (pinned selection) — but the three
margin states are mutually exclusive (`:4585`, `:4716`, `:4850`), so exactly one is live.
`LivingMargin` itself mounts once, at `src/renderer/components/ScripturePage.tsx:5416`.

`ConnectionCard.tsx` contains **zero** references to podcasts, episodes, audio or moments.
`ScripturePage.tsx`, `CommandPalette.tsx` and `SearchView.tsx` likewise contain zero references
to moments. Search IPC is `search-notes`, `search-scripture-text`,
`language-search-entities` (`src/electron/main.ts:2592, 2743, 2833`) — **no transcript or
moment search exists anywhere**.

So: 41,426 moments have exactly one door, and it is the third block down the Overview tab of
the Living Margin.

### 1b. Episode → references (player side)

**Artifact.** per-record `references/*.json`, loaded by `src/host/reference-loader.ts`, gated
at `:25` on `isTranscriptEnabledSource` (returns `ungranted`). Validation in
`src/core/references.ts:88-111`; sorted by `at` at `:108`. Splitters `subjectsOf` (`:114-117`,
longest treatment first) and `passingIn` (`:120-122`, in time order).

**Load.** `src/renderer/components/PodcastPlayer.tsx:524-538` — one fetch each for transcript
and references per `episode.recordId`, deliberately once per episode not once per sheet-open.

**Render.** Same file, `:806-894`. `subjects` at `:582`, `passing` at `:583`.

### 1c. Where the two meet

They do not. `passage-index.json` is generated from the same reference artifacts, but the two
render paths share no component, no ordering, no row grammar and no activation semantics. The
only shared object is `playPodcastEpisode` (`PodcastPlayer.tsx:165-188`) and the
`nowPlaying` store (`:125-158`).

---

## 2. Player → passage: what a listener can reach

**Inline in the transcript: nothing.** `renderedLines` (`PodcastPlayer.tsx:654-674`) renders
each line as a `<button onClick={() => seekPodcast(line.s)}>`. There is no reference marking,
no chip, no link — a line in which the speaker says "Deuteronomy 32:8" is plain text whose only
behaviour is to seek the audio to itself. The reference set is loaded and in scope at that
point (`refs`, `:432`) and is not consulted.

**The Passages view.** Reachable only through a two-tab strip at `:806-828`, which renders
under the condition `(subjects.length + passing.length > 0) && lines.length > 0`. Default view
is `"transcript"` (`:430`). Two lists: `subjects` (`:837-863`) and, under the heading
"Also referenced", `passing` (`:869-892`).

**Activation.** `goToMoment` at `:590-595`: `seekPodcast(seconds)`, clear the search, resume
following, switch back to the transcript. Audio keeps playing. **The reading canvas is not
touched.** Every one of the 12-median references in an episode names a passage — `r.title`,
"Romans 8:1-11" — and printing that title is the entire extent of what the player does with it.
There is no way from that list to open the passage.

**The one player → canvas control.** `.podcast-mast-passage`, `PodcastPlayer.tsx:734-743`,
rendered `{passage && !expanded && ...}`. Two consequences:

- it is the episode's single `bref`, not any of its references; and
- **it disappears when the sheet is open** — i.e. exactly when the reader is looking at the
  passage list, the only navigation control in the dock is removed from the DOM.

**Its `bref` is wrong for the commonest launch path.** All three `TaughtHereBlock` call sites
pass `bref: \`bref:v1/${book}.${chapter}.1\`` — the chapter the *reader* was on, verse 1
(`LivingMargin.tsx:4618`, `:4749`, `:4883`). The chip's accessible name at
`PodcastPlayer.tsx:736` reads "Read {passage}, **the passage this episode works through**".
For any episode started from Taught here, that sentence is false: the chip names the reader's
own chapter. Pressing it calls `navigateTo` (`:683-690`) → `handleNavigateToRef`
(`app.tsx:897-913`) → `goTo(..., verse: 1, rangeEnd: 1, preapproved: true)`
(`ScripturePage.tsx:2006-2011`), which reaches `performNavigation` and runs
`applyPassageSelectionRestore` + `setReferenceViewportTarget({verse: 1})`
(`ScripturePage.tsx:1890, 1920-1927`). Net effect: **a reader on Deuteronomy 32:35 who presses
the chip is thrown to 32:1 and loses their selection, having pressed a control that promised to
take them to the episode's passage.**

**Dead subsystems in the dock.** `PodcastEpisode.chapters` is documented as never supplied
(`:73`) and no call site supplies it — grep confirms `chapters:` appears in no
`playPodcastEpisode(...)` argument. Therefore `chapters` is always `[]` (`:604`), and all of
the following never render: the chapter list `:896-918`, the `podcast-dock-now` line
`:1027-1036`, and the rail ticks `:1073-1080`. `player.css` styles all of them
(`.podcast-chapters` `max-height:196px` at `:217`, `.podcast-chapter*` `:704-716`,
`.podcast-dock-now-title` `:818-824`). **The scrub rail's tick mechanism exists, is styled, and
is fed by the one array that is always empty — while the array that would actually populate it
(`refs`, 12 median entries with timestamps) sits unused two hundred lines away.**

---

## 3. Passage → player: what a reader sees on the page

**Surface.** `TaughtHereBlock`, `LivingMargin.tsx:411-517`. Masthead "From the transcripts /
Taught here" (`:476-479`). Three drawers, **all shut on mount** (`:416`,
`useState<Set<string>>(new Set())`):

| key | label (verse selected) | label (no verse) | membership |
|---|---|---|---|
| `on` | "On this passage" | — (empty, filtered out) | range contains the verse |
| `whole` | "The chapter as a whole" | same | `verses === null` |
| `around` | "Around it" | "Elsewhere in the chapter" | everything else |

Each drawer shows a count (`:500`) and, when opened, `items.slice(0, 25)` (`:504`) plus a
plain `<li>` reading "*N* more, shortest last" (`:505-509`) — **inert text, not a control.**

**Row grammar** (`:456-472`, CSS `styles.css:19450-19517`): a two-row grid.
`episode` (reading face, medium, single-line ellipsis) and `extent` (mono, tabular, "11 min" /
"48s") on row 1; on row 2 a run of `{title} {sourceName} · {m:ss}{ · relation}`, all of it
`--text-tertiary`, single-line, ellipsised.

**Relation handling.** `LivingMargin.tsx:468`:
`{m.relation !== "subject" && \` · ${m.relation === "allusion" ? "alluded" : m.relation}\`}`.
So the raw enum strings **"crossref"** and **"mention"** are printed into the reading surface.
`crossref` is the largest class in the corpus — 18,091 of 41,426, 44% of everything — and its
label is a schema token. There is no `data-relation` attribute on `.taught-here-row` at all, so
no CSS hook exists either.

**Activation.** `onPlay` → `playPodcastEpisode` with `startAt: m.at`
(`LivingMargin.tsx:4610-4621` and twins). Audio starts at the moment; the dock appears; the
canvas does not move; the reader stays where they were reading. That part is right.

**The Deuteronomy 32 question, as it stands today.** The index now holds **137** moments for
DEU 32 (up from the 71 of the earlier investigation), from 137 distinct episodes. Against that,
28 title-level manifest records carry a `DEU.32*` bref — and **25 of those 28 are the same
episodes that also appear as moments.** The surfacing decision today is therefore not "0 vs
71"; the loader fix landed. What replaced it is a duplication: on one screen, in one tab, the
same 25 episodes are drawn twice —

| | Published resources | Taught here |
|---|---|---|
| component | `TrustedResourcesBlock` `LivingMargin.tsx:519-852` | `TaughtHereBlock` `:411-517` |
| kicker / name | "Local publisher index / Published resources" `:618-621` | "From the transcripts / Taught here" `:476-479` |
| grouping | by publisher, behind imprint chips `:629-660` | by proximity to the verse `:436-454` |
| ordering | score → span → language → date `trusted-resources.ts:292-297` | seconds, longest first `passage-index.ts:192` |
| brand | publisher mark / colour on the card `styles.css:19903-19934` | none — publisher is grey tertiary text |
| play | starts at 0:00 `LivingMargin.tsx:785-795` | starts at the moment `:4610-4621` |
| external | "Listen ↗" to the official page `:809-825` | **none** |
| identity key | `${source.id}:${record.id}` `:768` | `${m.sourceId}:${m.id}` `:4611` |

The two identity keys are **the same string** (both resolve to e.g.
`bibleproject:bibleproject:podcast:moses-final-words`), which produces the sharpest defect in
this report — see §4.1.

**Episode identity, brand, timestamp, relation, on the moment row.** Episode title: yes,
clipped to one line. Publisher: name only, tertiary grey, no mark, no colour — the brand
system that exists for the cards (six approved marks, eleven palettes,
`styles.css:19654-19867`) does not reach this surface. Timestamp: yes, `m:ss`. Duration: yes,
leading. Relation: as raw enum text. Passage reference (`m.title`): yes, first thing on the
meta line.

---

## 4. Presentation quality and density

**Paper-and-ink language.** `.taught-here` is fully tokenised — zero hardcoded colours between
`styles.css:19307` and `:19545`; it reads on the margin's own paper and responds to all four
themes. `.podcast-dock` and `.podcast-ref` deliberately do not: they resolve
`--resource-source` / `--resource-ink` etc., which for any known publisher are literal hex
(68 values across 11 blocks, `styles.css:19659-19863`), with the reasoning recorded at
`:19623-19627`. So the dock **does not respond to theme polarity at all** — e.g. the
`listeners-commentary` palette is `#0a2450` ink on `#dfeaf8`, a light card that stays light in
Onyx. Whether that is right is a decision; it is currently invisible as one.

**Themes: four, not six.** `src/renderer/theme.ts:13` — `light | dark | porcelain | onyx`,
applied at `app.tsx:1780-1781` as a `theme-*` class plus a bare `dark` class. There is **no
`[data-theme=…]` selector in any renderer stylesheet**. `theme.ts:5-11` records that Glass and
Candlelight were materials, not themes.

**Density, chapter side.** Median 18 moments; Genesis 1 holds 922. The drawers handle this
honestly at rest (three shut rows and a count) but badly on open: 25 rows and then a dead
sentence. In Genesis 1 that is 25 shown of ~900, with no path to the rest. The in-code comment
at `LivingMargin.tsx:426` and the CSS comment at `styles.css:~19420` both say "seven moments at
the median and 427 at Genesis 1" — the dataset has since more than doubled and both numbers are
stale by 2.6× and 2.2×.

**Density, episode side.** median 12 references, p90 25, max 64. `.podcast-refs-view` is capped
at 300px with a fade mask (`player.css:337-350`), so the episode with 64 renders as an
unlabelled scroller inside a sheet that has no scroll of its own. There is no count of what is
below the fold beyond the tab's total badge (`PodcastPlayer.tsx:825`).

**Relation types are flattened in CSS.** The only two `[data-relation]` selectors in the entire
repo are `player.css:393` (`:not([data-relation="subject"])` → softer ink) and `:410`
(subject titles get medium weight). `crossref`, `mention` and `allusion` are **pixel-identical
to each other**. The only differentiator is text: `PodcastPlayer.tsx:884` writes "alluded" for
allusions and an **empty string** for crossref and mention, so those two rows render an empty
`<span>` and are indistinguishable in every respect. 18,091 crossrefs and 5,078 mentions are
one undifferentiated class on the player side, and two bare enum words on the margin side.

**Truncation.** Single-line hard clip (`overflow:hidden` + `ellipsis` + `nowrap`) on:
`.taught-here-episode` (`styles.css:19491`), `.taught-here-meta` (`:19500`),
`.podcast-ref-title` (`player.css:402`), `.podcast-ref-why` (`:429`),
`.podcast-dock-title` (`:794`), `.podcast-mast-passage` (`:132`). The `.podcast-ref-why` case
is the notable one: it is the *evidence quote*, the speaker's own words that justify the row's
existence, and the corpus median evidence length is 52 characters with a p90 of 69 — inside a
`minmax(0,1fr)` column in a `min(--margin-width, …)` dock. It will clip routinely. The
component comment at `PodcastPlayer.tsx:852-857` argues the evidence is "too important to hide";
the stylesheet hides most of it.

**Brand.** Six approved marks (`working-preacher`, `bibleproject`, `enter-the-bible`,
`naked-bible`, `spoken-gospel`, `the-gospel-coalition`); five sources carry colour only
(`forty-minutes-ot`, `five-minutes-church-history`, `ask-nt-wright`, `listeners-commentary`,
`radically-christian`). The comment at `styles.css:19631` still says marks ship for three. The
comment at `PodcastPlayer.tsx:729-731` points at `player.css` for the substitution rule;
`player.css:114-119` explains that the rule is deliberately *not* there (relative `url()`
resolution) and it actually lives at `styles.css:19903-19934`. Five of the eight sources in the
moment index have no mark — and the moment index's own five markless sources
(`forty-minutes-ot`, `five-minutes-church-history`, `ask-nt-wright`, `listeners-commentary`,
`radically-christian`) are exactly the five on the `public-feed` footing.

**The two-footing gate, and reference surfacing.** `src/core/transcripts.ts:72-94` records the
basis per publisher: three `publisher-granted` (bibleproject, naked-bible, spoken-gospel), five
`public-feed` (ask-nt-wright, five-minutes-church-history, forty-minutes-ot,
listeners-commentary, radically-christian). By moment count that is **21,425 granted vs 20,001
un-asked — 48% of everything "Taught here" shows comes from publishers who have not been
asked.** `readPassageIndex` gates on `isTranscriptEnabledSource` (`passage-index.ts:190`),
which is footing-blind by construction (`transcripts.ts:97-100`).

`transcriptBasis()` and `TRANSCRIPT_UNASKED_SOURCES` are declared (`transcripts.ts:93, 102`)
and are referenced **only from `tests/transcripts.test.ts`** — never from any `src/` module and
never from any component. `docs/trusted-resource-permissions.md` states this is intentional
("The gate treats both footings alike on purpose — the enforcement is about whether a source is
enabled at all"), and that "Nothing else moves. These sources take generic treatment — their
name in type, no mark". That holds today. But the doc also says "**The distinction must stay
visible**", and the only place it is currently visible is a TypeScript literal and a test.
Nothing a reader or a maintainer looking at the running app can see distinguishes a granted
publisher's moment from an un-asked one. Whether *surfacing* should carry the distinction is a
live design question (§6.7), not a settled one.

---

## 5. A11y and theming of these surfaces

**No focus styling at all on the whole `taught-here` family.** Neither `.taught-here-row`
(`LivingMargin.tsx:458`) nor `.taught-here-toggle` (`:484`) — both real `<button>`s — has a
`:focus-visible` or `:focus` rule anywhere. They get the UA default ring against a
`--radius-pebble` corner, while every neighbouring interactive family in the same stylesheet
uses `outline: 2px solid var(--accent-seal)`. `.taught-here-toggle:hover` changes colour
(`styles.css:19365`) with no keyboard counterpart.

**No `forced-colors` coverage for `taught-here`.** Eight `@media (forced-colors: active)`
blocks exist (`styles.css:3149, 5350, 18725, 18965, 19283, 20533`; `player.css:1180`;
`marking-actions.css:630`) and none names a `taught-here` class. `:hover { background:
var(--surface-hover) }` flattens with no substitute, and the masthead's 3px rule loses its
distinction from the 1px hairlines.

**Partial `forced-colors` coverage in the dock.** `player.css:1180-1216` covers the transport,
mast, clock, chapters and scrub — and covers **none** of the references or transcript
surfaces. Concretely: `.podcast-view-tab[aria-selected="true"]` (`player.css:290-293`) loses
its only selected indicator, and `.podcast-transcript-line[data-d="1|2|3"]`'s opacity ladder
(0.5 / 0.32 / 0.22, `player.css:665-667`) is never reset — far transcript lines stay at 22%
opacity in high-contrast mode.

**`.trusted-resource-play`** is not in the forced-colors block; its `[aria-pressed="true"]`
state (`styles.css:20434`) collapses, so playing and not-playing become identical.

**No `prefers-reduced-motion` coverage for `taught-here`.** `.taught-here-chevron` animates a
90° rotation (`styles.css:19367-19380`), and `-toggle`, `-row`, `-more` all carry transitions;
none is disabled. The dock, by contrast, is thoroughly covered
(`player.css:575-577, 693-702, 1157-1178`).

**`@media (prefers-contrast: …)` does not exist anywhere in the app's CSS.**

**`--focus-ring` is never declared.** `player.css:687` reads
`var(--focus-ring, currentColor)`; no stylesheet declares the token, so the fallback always
wins.

**The dock's view switcher is not a tablist.** `PodcastPlayer.tsx:807-827`: `role="tablist"`
with two `role="tab"` buttons, but no `id`, no `aria-controls`, no `role="tabpanel"` on the
content at `:835`, no roving `tabIndex`, and no arrow-key handler. It announces a pattern it
does not implement.

**Drawer toggles carry `aria-expanded` with no `aria-controls`** (`LivingMargin.tsx:484-485`)
to the `<ul>` they open.

**Transcript scale.** `renderedLines` renders one `<button>` per reading line for the whole
episode. Sampled transcripts run a median of 5,131 words and a max of 11,514, which at the
~10-words-per-line target of `readingLines` (`transcripts.ts:133-135`) is a median of ~513 and a
max of ~1,150 focusable buttons inside a 340px scroller. There is no keyboard escape and no
virtualisation. Separately, "stop following" is bound only to `onWheel` and `onTouchMove`
(`PodcastPlayer.tsx:966-967`) — a keyboard user tabbing or arrowing through the transcript never
turns following off and gets dragged back to the playhead by the effect at `:631-634`.

---

## 6. Guising as polish — what looks finished but is unresolved design

1. **The scrub rail's tick system.** Styled (`player.css:885`), coded
   (`PodcastPlayer.tsx:1073-1080`), and fed exclusively by `chapters`, which the type itself
   documents as "Optional, and currently never supplied" (`:73`) — confirmed: all four
   `playPodcastEpisode(...)` call sites (`LivingMargin.tsx:785, 4610, 4741, 4875`) omit it. Meanwhile the array that
   *would* fill it — 12 median timestamped references — is in scope and unused. The rail looks
   like a feature awaiting data; it is a feature awaiting a decision about whose data.

2. **The whole chapter subsystem in the dock.** `.podcast-chapters` list, `podcast-dock-now`
   line, chapter ticks, `chapterSpanLabel`, `chapterIndex` — ~90 lines of TSX and ~110 lines of
   CSS that never render.

3. **"N more, shortest last."** `LivingMargin.tsx:505-509` renders a plain `<li>`. There is
   dead CSS for a `.taught-here-more` **button** at `styles.css:19519-19538`, and dead CSS for
   `.taught-here-section` at `:19425-19448`, and a dead
   `.taught-here[data-expanded="true"]` rule at `:19540-19545` (`data-expanded` is never set on
   that element). A control was removed and its styling stayed; the sentence that replaced it
   reads like a disclosure and is inert.

4. **`.taught-here-list { max-height: 300px }` is declared twice**, verbatim with its comment,
   at `styles.css:19333` and `:19405`.

5. **Evidence, argued for and then clipped.** `PodcastPlayer.tsx:852-857` makes an explicit case
   for showing the evidence quote rather than hiding it behind a hover; `player.css:429-437`
   gives it `white-space: nowrap` in a narrow grid column. Median evidence is 52 chars.

6. **`resetPassageIndex`** — an exported cache-invalidation hook called from nowhere
   (`passage-index-loader.ts:26`).

7. **The relation vocabulary.** Four values in the schema, two in the CSS, and on the margin
   side two of them printed as raw enum tokens. It reads as a considered taxonomy and behaves
   as a boolean.

8. **Stale numbers in load-bearing comments.** "seven moments at the median and 427 at Genesis
   1" (`LivingMargin.tsx:426`, and again in `styles.css` near `:19420`) against an actual 18 and
   922. "Marks ship for Working Preacher, BibleProject and The Gospel Coalition"
   (`styles.css:19631`) against six shipped marks. The comment at `PodcastPlayer.tsx:729-731`
   points at the wrong file for the mark rule.

9. **`role="tablist"` in the dock** (§5) — the ARIA pattern is announced, not implemented.

10. **`--focus-ring`** — a token referenced once and declared nowhere.

11. **`playPodcastEpisode`'s `startAt` seek flashes.** `:172` optimistically announces the
    start offset, then the JSX `onLoadedMetadata` handler at `:698` announces
    `announceElapsed(0, duration)` — resetting the clock and scrubber to 0:00 — before the
    later-registered `seekOnce` listener (`:179-185`) moves the element. The clock visibly
    snaps to zero and back on every moment launch.

---

## 7. The broken loop — every dead end

The loop the reader asked about is: *hear a passage mentioned → open it → see what else
discusses it → jump back to where I was listening.* Step 1→2 has no path at all. Here is every
break, sharpest first.

**7.1 — Pressing a moment for an episode that is already playing pauses it.**
`playPodcastEpisode` (`PodcastPlayer.tsx:165-169`): if `nowPlaying.episode?.id === episode.id`
it calls `togglePodcast()` and **discards `startAt` entirely**. The identity keys of the two
surfaces are identical strings (`LivingMargin.tsx:768` vs `:4611`). So:
- an episode started from its Published-resources card, then pressed in Taught here to reach the
  moment → **pauses**;
- an episode playing from Deuteronomy 32's Taught here, reader navigates to Deuteronomy 33 and
  presses the same episode's moment there → **pauses**.
The second case is not rare: 41,426 moments across 3,208 episodes is ~13 chapters per episode.
(Within a single chapter no episode appears twice — verified across all 1,170 entries — so the
collision is always cross-surface or cross-chapter.)

**7.2 — Nothing in the player can open a passage.** The Passages view prints 12 median passage
titles per episode and every one of them is seek-only (`goToMoment`, `:590-595`). The episode's
references carry a canonical `bref` (`references.ts:31`) that is loaded, validated, and never
used for navigation.

**7.3 — The transcript never names a reference.** A listener who hears "turn to Romans 8" sees
plain text. The reference set with its `at` timestamps is in the same component's state.

**7.4 — The one navigation chip vanishes when the sheet opens.** `{passage && !expanded}`,
`PodcastPlayer.tsx:734`.

**7.5 — That chip lies, and destroys the reader's selection.** For every Taught-here launch its
`bref` is the reader's own chapter at verse 1 (`LivingMargin.tsx:4618`), its accessible name
claims it is "the passage this episode works through" (`PodcastPlayer.tsx:736`), and pressing it
replaces the current selection and scrolls to verse 1 (`ScripturePage.tsx:1890, 1920-1927`).

**7.6 — "N more" is not a control.** In Genesis 1, 25 of ~900 are reachable
(`LivingMargin.tsx:504-509`).

**7.7 — No way to ask "what else discusses this" except by navigating there first.** There is no
transcript search, no moment search, no episode search. `SearchView` and `CommandPalette`
contain no reference to any of it. The corpus is reachable only chapter-by-chapter through one
collapsed drawer.

**7.8 — Latent: references become unreachable when a transcript fails.** The tab strip renders
on `(subjects + passing > 0) && lines.length > 0` (`PodcastPlayer.tsx:806`) and `view` can only
be changed from that strip (`:812, 820`). A record with references and an unreadable or
schema-refused transcript shows no references at all. Not currently triggered — all 3,208
reference files have a transcript — but the coupling is arbitrary.

**7.9 — The way back is unmarked, though it works.** The dock is app-level
(`app.tsx:2287`) and survives navigation, so "return to where I was listening" is really
"the dock is still there". But nothing in it says which *moment* is playing: the mast shows the
episode title and, when launched from a moment, a passage chip naming the reader's own chapter.
The moment's own passage, relation and evidence — all of which were on the row the reader
pressed — are gone the instant they press it.

---

## 8. Design questions worth a decision, sharpest first

1. **Is a moment a thing, or just a timestamp on an episode?** Everything downstream turns on
   this. Today the moment exists on the margin row and evaporates on press: the dock has no
   representation of "the eleven minutes on 32:35-43 you chose". If a moment is a thing, the
   dock needs to name the one that is playing, and the rail needs to mark the others.

2. **Should the reference title in the player be a link to the passage?** 41,426 rows name a
   passage and none of them opens it. This is the single largest unrealised affordance in the
   feature, and it is the missing half of the loop.

3. **What is the relationship between "Published resources" and "Taught here"?** For
   Deuteronomy 32, 25 of 28 title-level records are also moments — the same episodes, twice on
   one screen, with different ordering, different brand treatment, different play semantics, and
   colliding identity keys (§7.1). Are these one surface with two lenses, or two surfaces with a
   deduplication rule, or is the title-level claim now subsumed by the transcript evidence?

4. **What do `crossref` and `mention` mean to a reader?** 23,169 moments (56% of the corpus) are
   labelled with a schema token or with nothing. `crossref` in particular is the *largest* class
   and arguably the most interesting one — "this passage was brought in to illuminate something
   else" is a different and often better offer than "this episode is about it". It currently
   reads as noise below the fold.

5. **What is the answer for Genesis 1?** 922 moments in a drawer that shows 25. Every mechanism
   in the block (bands, longest-first, the count) was designed against a median of 7 and a max of
   427. The distribution has moved; the surface has not.

6. **Should the transcript carry reference marks?** All the data exists. The counter-argument is
   that a transcript with marks stops being reading and becomes an index — worth stating rather
   than defaulting.

7. **Does surfacing owe anything to the two footings?** 48% of every moment shown comes from a
   publisher who has not been asked. The doc's position — the gate is binary, generic treatment
   is the only visible consequence — is defensible and recorded. But `TRANSCRIPT_UNASKED_SOURCES`
   exists precisely so the distinction stays visible, and the only place it is visible today is a
   test file.

8. **Does the dock belong to the publisher or to the app?** The dock takes a hardcoded publisher
   palette that ignores theme polarity — a light card in Onyx, by design
   (`styles.css:19623-19627`). That is a real position, but "Taught here" takes the opposite one
   (fully tokenised, no brand at all). The same 25 episodes wear two opposite brand policies six
   inches apart.

9. **Should `.taught-here` be a first-class study surface rather than the third block of the
   Overview tab?** It has no tab count (`tabCount`, `LivingMargin.tsx:4267-4272`, returns null
   for `overview`), sits below `IntentOverview` and `TrustedResourcesBlock`, and opens shut.
   1,170 chapters have something to say here and a reader has no signal that any of them do.

10. **What does the "Around it" / "Elsewhere in the chapter" band mean with no verse selected?**
    (`LivingMargin.tsx:449`) — elsewhere than what? At chapter scope the two visible drawers are
    "The chapter as a whole" and "Elsewhere in the chapter", which is a distinction the reader
    has not yet asked for.
