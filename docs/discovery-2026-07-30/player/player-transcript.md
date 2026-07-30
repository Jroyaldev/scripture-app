# Podcast transcript surface — discovery

Read-only pass over `/Users/jonnyroyal/dev/scripture-app-quire` (branch `codex/quire-redesign`).
Nothing built, nothing run, nothing written in the repo.

The whole player is **new on this branch** — `git diff --stat main...HEAD` shows
`PodcastPlayer.tsx` (1102), `player.css` (1227) and `core/transcripts.ts` (234) as pure additions.
There is no prior version to regress against; everything below is first-draft design.

---

## 0. Data → render

**On disk.** `~/ScriptureLibrary/.artifacts/transcripts/<key>.json`, one file per episode.
3,521 files, **970 MB**, largest 1.26 MB. Key mangling at
`/Users/jonnyroyal/dev/scripture-app-quire/src/core/transcripts.ts:185-187` (`:` → `__`).

Measured file shape (Spoken Gospel, 8,253 s = 2h18m):

```
keys: schema, generated, model, id, title, audioUrl, brefs, text, words, segments, lastWordEnd, audioSeconds
model: nvidia/parakeet-tdt-0.6b-v3
words: 24,995   segments: 2,449
word: {"w":"Jesus","s":4,"e":4.56}
seg:  {"t":"Jesus still reigns, he still has all authority, …","s":4,"e":15.84}
```

**Note the divergence:** the file carries `title`, `audioUrl`, `brefs`, `text`, `lastWordEnd`.
The `Transcript` interface at `src/core/transcripts.ts:32-45` declares **none of them**, and
`readTranscript` (`:203-234`) reconstructs a new object keeping only
`schema/generated/model/id/words/segments/audioSeconds`. Five fields are silently dropped at the
boundary. `text` (the whole flat transcript) and `brefs` are the two a search surface would most
want, and both are thrown away before the renderer sees anything.

**Host path.** `loadTranscript` (`src/host/transcript-loader.ts:19-39`) is a **synchronous**
`readFileSyncInterruptible` + `JSON.parse` on the main process, gated by publisher grant *before*
the file is touched (`:24`). IPC `transcript-load` at `src/electron/main.ts:2462-2471`, preload at
`src/electron/preload.ts:140-142`, typed at `src/renderer/api.ts:108-114`. A 1.26 MB parse plus a
25k-element sort (`core/transcripts.ts:229-230`) runs on the **main process, blocking**, once per
episode press.

**In memory.** `PodcastPlayer.tsx:524-538` loads once per `episode.recordId` — not per sheet-open,
and **not cancelled or evicted**. `undefined` = unasked, `null` = known absent (`:422`).

**Segmentation.** The recogniser's `segments` are *discarded for display*. `readingLines`
(`core/transcripts.ts:142-178`) rebuilds lines from the **word stream** with a typesetter's
preference order — sentence end ≥5 words, clause end ≥10, ≥1.2 s pause, hard cap 16
(`:133-140`). This is the one genuinely excellent piece of design on the surface, and its
docstring earns it: measured segment lengths of 1–83 words and 0.1–39 s are correctly diagnosed as
"shaped by breathing, not by reading."

Cost, measured by re-running the algorithm over real files:

| episode | audio | words | segments | **readingLines** |
|---|---|---|---|---|
| spoken-gospel fc6b818a | 2h18m | 24,995 | 2,449 | **2,280** |
| forty-minutes-ot 3b6497fd | 1m48s | 244 | 12 | **18** |

**Timestamp → element binding.** There is none, structurally. `line.s` is closed over in the click
handler (`:668`) and that is the only binding. The active line is found by a full linear scan on
every render — `lines.reduce(…)` at `:622-625`, "the last span that has started". Word-level
timings exist in the payload and are **never used** past `readingLines`; there is no per-word
highlight, no `<span>` per word, nothing.

**Virtualization: none.** `renderedLines` (`:654-674`) maps every line to `<li><button>`. A 2h18m
episode mounts **2,280 buttons / ~4,560 DOM nodes**, and mounts them the moment the episode starts
playing — the sheet is rendered whenever `episode` exists (`:792`), collapsed only by
`grid-template-rows: 0fr` (`player.css:188-194`). The reader never has to open the transcript to
pay for it.

Worse: `renderedLines` is memoized on `[found, lineIndex, needle, searching]`. `lineIndex` changes
roughly once per line (~4 s), so **all 2,280 elements are rebuilt and reconciled every ~4 seconds,
forever, whether or not the sheet is open**. The `useMemo` is doing the opposite of what its
comment claims: the comment (`:636-640`) argues keying on `lineIndex` instead of `position` cuts
rebuilds from 4/s to 1-per-line, which is true and still 15 full-list reconciliations a minute for
a surface nobody is looking at.

And the CSS cost is the real one. `data-d` (`:666`) is `Math.min(3, |index − lineIndex|)`, so on a
2,280-line episode **~2,274 elements carry `data-d="3"` → `filter: blur(1.9px)`**
(`player.css:667`) simultaneously. A blur filter forces a separate paint/composite pass per
element. This is 2,274 blurred layers to render a four-line window.

---

## 1. The follow / search / seek state machine, as found

### States (all component-local, all in `PodcastPlayer.tsx`)

| state | line | initial | reset on episode change? |
|---|---|---|---|
| `following: boolean` | `:424` | `true` | **NO** |
| `query: string` | `:425` | `""` | **NO** |
| `view: "transcript" \| "passages"` | `:430` | `"transcript"` | **NO** |
| `expanded: boolean` | `:418` | `false` | yes (`:516`) |
| `peeking: boolean` | `:454` | `false` | yes (`:517`) |
| `rateIndex: number` | `:433` | `0` | **NO** |
| `transcript` | `:422` | `undefined` | yes (`:526`) |
| `refs` | `:432` | `undefined` | yes (`:527`) |
| `scrubbingAt: number \| null` | `:413` | `null` | no |

Derived: `searching = query.trim().length > 0` (`:641-642`);
`lineIndex` (`:622-625`); `found` = filtered lines (`:648-651`); `matches = found.length` (`:652`).

The episode-change effect is `:515-519` and it touches **only** `expanded`, `peeking` and the peek
timer. Everything in the "NO" column above survives across episodes for the life of the session.

### The follow effect — the whole of it

`PodcastPlayer.tsx:631-634`:

```js
useEffect(() => {
  if (!expanded || !following || lineIndex < 0) return;
  activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
}, [lineIndex, following, expanded]);
```

Three guards, three dependencies. **`searching` is in neither.** That single omission is the
source of the search scroll-jack (defect D3).

`activeLineRef` (`:423`) is a single ref attached conditionally inside the map:
`ref={index === lineIndex ? activeLineRef : undefined}` (`:655`). When a filter is active and the
playing line is filtered out, `activeLineRef.current` is `null` and the effect is a silent no-op.

### Transitions OUT of following (following → false)

Exactly **two**, both on the `<ul>` at `:963-968`:

- `onWheel={() => setFollowing(false)}` — `:966`
- `onTouchMove={() => setFollowing(false)}` — `:967`

That is the complete list. Note what is *not* here:

- **keyboard scrolling** (Arrow / PageUp/Down / Space / Home / End) — no handler, following survives
- **scrollbar drag** — impossible anyway: `scrollbar-width: none` (`player.css:600`) and
  `::-webkit-scrollbar { width: 0 }` (`:617`). The list has **no visible scrollbar at all**
- **Tab-through-lines focus scroll** — native `scrollIntoView` on focus fires no wheel event
- `scroll` events are deliberately not listened to (correct — programmatic smooth scroll would
  self-cancel), but the consequence is that only two of the many ways to scroll are detected

### Transitions INTO following (following → true)

Exactly **three**:

1. `goToMoment(seconds)` — `:590-595`, wired to every passage row (`:844`, `:878`).
   Does the **full errand**: `seekPodcast` + `setQuery("")` + `setFollowing(true)` + `setView("transcript")`.
2. `clearSearch()` — `:600-603`. `setQuery("")` + `setFollowing(true)`.
   Wired to the "N · clear" button (`:942`) and to Escape in the search field (`:934`).
3. The Follow pill — `:983`, `onClick={() => setFollowing(true)}`. Visible only when
   `!following && !searching` (`:980`).

### The seek surfaces, and what each does to follow state

| surface | line | seeks | restores follow | clears query |
|---|---|---|---|---|
| passage row (subject) | `:844` → `goToMoment` | yes | **yes** | **yes** |
| passage row (passing) | `:878` → `goToMoment` | yes | **yes** | **yes** |
| **transcript line** | **`:668`** | yes | **NO** | **NO** |
| chapter row | `:905` | yes | **NO** | **NO** |
| scrub commit | `:567-571` | yes | **NO** | **NO** |
| back 15 / fwd 30 | `:1003`, `:1020` | yes | **NO** | **NO** |
| play / pause | `:1012` | — | **NO** | — |

`goToMoment`'s comment (`:586-589`) states the intent in the codebase's own words:

> *"Choosing a passage is a request to HEAR it, not to read about it. So the press does the whole
> errand: move the audio, return to the transcript, and start following again — landing a reader in
> the passage list they just left, with the words scrolling somewhere behind it, would make them do
> the last two steps themselves every time."*

The transcript line click is the identical request and performs **one third of the errand**. This is
not an undecided design question — the decision is written down at `:586-589` and applied to one of
three seek paths. The commit that shipped following (`4e1e567 "feat: follow a transcript while the
episode plays"`) argues only about *scroll*: "Following stops the moment the reader scrolls, and
offers itself back rather than resuming on its own." A click was never reasoned about.

### `seekPodcast` itself

`:206-212`. Guard: `if (!element || !Number.isFinite(element.duration)) return;`

With `preload="none"` (`:703`), `duration` is `NaN` until metadata arrives. Every transcript click,
chapter click, passage click and scrub in that window is a **silent no-op** — no toast, no state
change, no visual acknowledgement. `goToMoment` is worse: it calls `seekPodcast` first, then
unconditionally sets `following`/`query`/`view` (`:591-594`), so a failed seek still produces a
confident-looking "we went there" state at the top of the episode.

`seekPodcast` also **never resumes playback**. Clicking a transcript line while paused moves the
playhead and leaves the reader in silence. Both reference implementations start playing on tap.

---

## 2. Presentation and motion inventory

### Typography and measure

| | value | file:line |
|---|---|---|
| line face | `1.0625rem/1.5 var(--font-reading)`, `-0.006em`, `text-wrap: pretty` | `player.css:635-638` |
| line box | `padding: 9px 12px`, `border-radius: var(--radius-pebble)` | `:628-630` |
| scroll box | `max-height: 340px`, `padding: 30px 0` | `:588-590` |
| dock width | `min(var(--margin-width), …)` = **380px** | `player.css:36`, `styles.css:383` |

Derived measure: 380 − 32 (dock padding) + 16 (block negative margin) − 24 (line padding) =
**340px of text at 17px** ≈ **40 characters per row**. That is below the 45–75 range, and it means a
10–16-word `readingLine` **wraps to 2–3 rows**. So the "line" the model reasons about and the visual
row the eye counts are not the same unit. The `data-d` distance ramp is written as if they were.

Visible window: 340 − 60 padding = 280px; a 2-row line ≈ 69px → **~4 lines visible**, of which the
mask (`:608-614`, 34px fades) leaves **~2.7 fully legible**. The comment at `:585-589` claims
"roughly five lines" — it is four, and effectively under three.

Consequence: `data-d` maxes at 3, i.e. ±3 lines ≈ ±207px, which **exceeds the visible box**. The
entire depth ramp is spent on lines the reader can barely see, and everything off-screen sits at
the same `data-d="3"`.

### The active-line treatment

`data-d="0"` (`:659-663`): `opacity: 1`, `filter: none`,
`text-shadow: 0 0 0.34px currentColor`. The docstring at `:653-658` is the best writing in the file
— optical weight via same-colour text-shadow instead of font-weight, precisely because a weight
change re-wraps the line and pushes the column. Correct and rare.

`data-d` 1/2/3 (`:665-667`): opacity 0.5/0.32/0.22 with blur 0.6/1.3/1.9px.
`data-past` softening (`:671-672`) so scrolling back "meets text, not fog."

**There is no `aria-current` styling anywhere.** Grep of both stylesheets returns nothing for
`.podcast-transcript-line[aria-current]`. The active line is expressed *solely* through `data-d="0"`.

### What is designed vs "text in a div"

Designed:
- `readingLines` re-segmentation (`core/transcripts.ts:142-178`) — the strongest idea here
- the depth/blur ramp and the past/future asymmetry
- the same-colour text-shadow instead of font-weight
- the edge mask so the autoscroll is hidden before it reaches a boundary (`:603-607`)
- the deliberate removal of timestamps, argued at `:579-583`
- the "auto" provenance chip (`:505-518`)
- the NO-TRANSFORM comment (`:619-624`) recording a real regression

Text in a div:
- **no paragraph or section structure.** 2,280 undifferentiated blocks. No speaker attribution
  (multi-host shows are in the corpus), no topic breaks, no chapter headings
- **no wayfinding whatsoever.** No scrollbar (`:600`, `:617`), no timestamps, no progress marker,
  no "you are at 47 min of 138." A reader who scrolls in a 2h18m episode has literally no way to
  know where they are
- **no relationship between the scroll container and the rail.** The dock's own progress rail
  (`:876-965`) sits 300px below the transcript and they share no visual language. The transcript
  does not know the rail exists
- the search field is a bare input with `outline: none` on focus (`:486`) and no box (`:472-479`),
  which is elegant right up until you need to know whether you are typing into it

### Motion

| what | spec | file:line | reduced-motion |
|---|---|---|---|
| dock entrance | `podcast-dock-in` 200ms, opacity + translateY(10) + scale(.99) | `player.css:52, 72-75` | disabled `:1158` |
| sheet open | `grid-template-rows 0fr→1fr` 300ms `(.2,.8,.2,1)` | `:191, 194` | disabled `:1165` |
| sheet contents | opacity 190ms + translateY(-5px) 300ms, 60ms delay | `:199-213` | disabled `:1164-1166` |
| **transcript autoscroll** | `scroll-behavior: smooth` **and** JS `behavior:"smooth"` | `:602` + `PodcastPlayer.tsx:633` | **NOT disabled — see D6** |
| line emphasis drift | opacity + filter 460ms `(.25,.9,.3,1)` | `:642-645` | `opacity 1ms`, `filter:none !important` `:695-698` |
| follow pill in | `podcast-follow-in` 260ms, opacity + translateY(7) | `:549, 564-567` | disabled `:576` |
| follow pill **out** | **none** — React unmount, instant pop | `PodcastPlayer.tsx:980` | n/a |
| **seek / jump** | **none** | — | — |
| **search filter** | **none** — list swaps instantly | — | — |
| **view tab switch** | **none** — unmount/mount | — | — |
| rail "reaching" | `seal-progress-travel` 1100ms linear ∞ | `:964` | disabled `:1177` |
| transport play hover/active | `scale(1.05)` / `scale(0.97)` | `:781-782` | disabled `:1174-1176` |
| focus-mode dock fold | width/height/radius/padding/shadow `--transition-normal` | `:983-996` | disabled `:1159-1163` |

**What should breathe but snaps:** every state change in the transcript itself. A seek is the
biggest event on the surface and it has no motion at all — the list either jumps (following) or
does nothing (not following), with no acknowledgement that the playhead moved. Search narrowing
2,280 lines to 12 is an instantaneous replacement. The follow pill fades in over 260ms and vanishes
in 0ms. `renderedLines` keys are `${line.s}-${index}` (`:655`) using the *original* index, so keys
are stable across filtering — the DOM nodes for surviving lines are reused, which means a crossfade
or FLIP transition is available for free and is not taken.

---

## 3. Guising as polish

Things that read as finished, considered work but are unresolved — the comment prose is unusually
persuasive here, which makes this list the important one.

1. **The search highlight is invisible.** `player.css:570`:
   `background: color-mix(in srgb, var(--accent, currentColor) 26%, transparent)`.
   **`--accent` is never defined.** Grep of the whole renderer: `--accent-seal` (105),
   `--accent-current` (45), `--accent-machine` (16) … and bare `--accent` appears **exactly once —
   at this line, as a consumer.** So it falls back to `currentColor`, which is `--resource-ink`,
   which is *the text colour*. On Spoken Gospel that is `#faf0d7` at 26% over `#239948`. The mark is
   a faint tint of the text colour behind the text colour. This rule has never been looked at
   against a real search.

2. **The `!searching` guard on the Follow pill** (`:980`) reads as restraint — "don't stack chrome
   during search." What it actually does is remove the only follow-state indicator at the exact
   moment the reader is furthest from the playhead.

3. **`data-d = 0 when searching`** (`:666`) is commented as *"every line sits at the same readable
   weight rather than pretending to a playhead the reader is not currently following."* But
   `data-d="0"` is not "readable weight" — it is the **active-line treatment**
   (`player.css:659-663`, opacity 1 + text-shadow). So during search, all 12 results are drawn as
   if all 12 are playing. The one thing you want in a hit list — which hit is the one you're at — is
   the one thing that is styled away.

4. **The reduced-motion block for the transcript** (`player.css:693-702`) is thorough and
   confident, and `scroll-behavior: auto` at `:694` is **dead** — `scrollIntoView({behavior:"smooth"})`
   at `PodcastPlayer.tsx:633` overrides the computed `scroll-behavior` by spec. Reduced-motion users
   get the full smooth autoscroll.

5. **The `renderedLines` memo comment** (`:636-640`) argues persuasively for keying on `lineIndex`
   instead of `position`. It is correct and it is still 2,280 elements reconciled every 4 seconds,
   including while the sheet is collapsed and invisible.

6. **`.podcast-refs-view` gets a fixed `max-height: 300px`** (`:337-350`) with the comment
   *"Height that depends on content is what let these push the transcript away."* The transcript
   below it gets `max-height: 340px` — but the two are in mutually exclusive views (`:835`, `:923`),
   so the problem the fixed height solves cannot occur. Vestigial.

7. **The `title` attributes.** `player.css:429-437` correctly argues that a native `title` "arrives
   after a second, in the system's own styling, and cannot be reached at all by touch" — and then
   `title` is used for the two explanations on this surface that a reader most needs:
   `title="Automatically transcribed by Pericope"` (`:956`) and
   `title="Clear search and follow along"` (`:943`).

8. **`scripts/qa-podcast-player.mjs` looks like coverage and isn't.** 508 lines, real network,
   real audio, thorough. It **never opens the sheet**. Zero references to `podcast-transcript`,
   `podcast-view-tab`, search, or following anywhere in `scripts/` or `tests/`. It also reads two
   selectors that no longer exist — `.podcast-dock-publisher` and `.podcast-dock-passage`
   (`qa-podcast-player.mjs:201-202`) against the component's actual `.podcast-mast-source` /
   `.podcast-mast-passage` — so `assert.equal(playing.publisher, "Naked Bible Podcast")` at `:281`
   is asserting `undefined === "Naked Bible Podcast"` and this tour **cannot currently pass**.

9. **`tests/transcripts.test.ts`** (10 tests) covers the loader's refusals, sorting, key mangling
   and the permissions-doc contract. It does not test `readingLines` at all — the one function whose
   output the reader actually sees.

---

## 4. Defects, with reproduction logic

### D1 — Clicking a transcript line does not re-engage following *(the reported defect)*

`PodcastPlayer.tsx:668` — `onClick={() => seekPodcast(line.s)}`

1. Sheet open, `following === true`.
2. Reader wheels the list → `:966` → `following = false`. Follow pill appears (`:980`).
3. Reader clicks a line → `seekPodcast(line.s)` → `currentTime` set → `announceElapsed` →
   `at` → `position` → `lineIndex` recomputes → effect `:631` runs → **`!following` → `return`**.
4. Audio is now at the line under the reader's cursor. The transcript does not centre it, does not
   move, and the Follow pill is still up. The reader has just told the app exactly where they want
   to be and the app still classifies them as "wandered off."
5. As playback continues, the voice walks off the bottom of a frozen list.

Intended behaviour is written at `:586-589` and implemented at `:590-595` for passage rows only.

### D2 — Clicking a search hit leaves the reader inside the filter

`:668` again; `query` is not cleared.

1. Reader types "Melchizedek" → 12 hits, list narrowed (`:648-651`).
2. Reader clicks a hit → seek only.
3. The list is **still the 12 hits**. The reader has jumped to a moment and cannot see the sentence
   before or after it — the entire reason for jumping there.
4. No affordance says so: the Follow pill is suppressed by `!searching` (`:980`).
5. Exit requires finding the `12 · clear` chip (`:939-948`) or knowing Escape works (`:934`).

Both reference players treat tapping a result as *"take me there,"* not *"stay in the filter."*

### D3 — Search results scroll-jack, intermittently

`:631-634` — `searching` is not in the guard and not in the deps.

1. Reader types a query without scrolling first, so `following` is still `true`.
2. Playback continues. Every ~4 s `lineIndex` changes and the effect fires.
3. **If the currently-playing line happens to be one of the hits**, `activeLineRef` is attached
   (`:655`) and the filtered list smooth-scrolls to it under the reader's cursor.
4. If it isn't, `activeLineRef.current` is `null` and nothing happens.

The result is a list that yanks itself unpredictably while you read search results.

### D4 — Search state, follow state and view survive across episodes

`:515-519` resets `expanded` and `peeking` only.

1. Play episode A, search "covenant", scroll the results (`following = false`).
2. Press play on episode B from a card.
3. B opens with `query === "covenant"` still in the box, `following === false`, and B's transcript
   filtered by A's search term. `setTranscript(undefined)` (`:526`) clears the data but not the lens
   over it.
4. Because `expanded` was reset to `false`, none of this is visible until the reader opens the
   sheet and finds a stranger's search in it.

The comment at `:415-417` explicitly reasons that `expanded` must not persist across episodes —
*"pressing play on a new card should give back the corner, not whatever the last one was left at"* —
and the same argument applies verbatim to all three of these and was not applied.

### D5 — Hard dead-end: stuck in the Passages view on a ref-less episode

Guards: tab bar `:806` requires `(subjects.length + passing.length > 0) && lines.length > 0`;
transcript block `:923` requires `view === "transcript"`.

1. Play an episode with references. Switch to the **Passages** tab (`:820`).
2. Without pressing a passage row (which would call `goToMoment` and reset `view`), play a
   different episode that has **no** references file.
3. `view` is still `"passages"` (never reset). `subjects` and `passing` are both `[]`, so the tab
   bar does not render. The transcript block does not render.
4. The sheet shows the episode title, the length, and **nothing else**. There is no control on
   screen that can get back to the transcript.

Corpus scale: 3,521 transcripts vs **3,208** reference files → **~313 episodes (~9%)** have no
references at all and are dead-endable this way. Recovery requires playing a ref-full episode,
switching the tab back, and returning. `view` persists for the whole session.

### D6 — Reduced motion does not stop the transcript autoscroll

`player.css:694` sets `scroll-behavior: auto` under `prefers-reduced-motion`, but
`PodcastPlayer.tsx:633` passes `behavior: "smooth"` explicitly, which by spec wins over the computed
`scroll-behavior`. A vestibular-sensitive reader gets a container that smooth-scrolls itself every
four seconds, with no way to turn it off other than wheeling once (D8 below) — which is exactly the
motion they are trying to avoid.

### D7 — Touch: a sloppy tap kills following, then seeks

`onTouchMove` at `:967` fires on any finger movement over the list, including the 2–3px drift of an
ordinary tap. Sequence on a real tap: `touchmove` → `following = false` → `click` → `seekPodcast`.
So on touch, **every** transcript tap lands in the D1 state. The `armPeek` handler (`:493-505`)
shows the codebase already knows to branch on `pointerType`; that lesson was not carried here.

### D8 — Following is cancelled by wheel events that scroll nothing, and not by scrolls that aren't wheels

`:966` fires on any wheel over the list. With `overscroll-behavior: contain` (`player.css:601`) a
wheel at the scroll extent chains nowhere but still fires — so idle wheeling at the bottom of the
list silently kills following. Trackpad momentum fires wheel events for ~1 s after the fingers lift.

Conversely, following survives: keyboard scrolling (no handler), Tab-through-lines focus scrolling,
and any programmatic scroll. There is no scrollbar to drag (`player.css:600`, `:617`).

A keyboard user tabbing forward through lines is fought by the autoscroll every ~4 s and has **no
way to stop it** — the only two off-ramps are wheel and touchmove.

### D9 — Clicking a line while paused seeks into silence

`seekPodcast` (`:206-212`) sets `currentTime` and nothing else. Both Apple Podcasts and Spotify
begin playback on tapping a line.

### D10 — Every seek is a silent no-op before metadata arrives

`:208` — `if (!element || !Number.isFinite(element.duration)) return;`. With `preload="none"`
(`:703`) there is a real window after pressing play where transcript clicks, chapter clicks,
passage rows and the scrub all do nothing and say nothing. `goToMoment` (`:590-595`) compounds it by
committing its UI side-effects regardless.

### D11 — 2,280 blurred elements, mounted and reconciled while invisible

Detailed in §0. `filter: blur(1.9px)` on ~2,274 elements (`player.css:667`); full list rebuild every
~4 s (`:654-674`) including while `expanded === false`.

### D12 — Latent: `onLoadedMetadata` fights `startAt`

`:698` announces `at = 0` on `loadedmetadata`; the `seekOnce` handler registered at `:179-185` runs
after (React's media listener is attached to the element first) and sets `currentTime = startAt`.
A one-frame flash at 0:00 and a momentary `lineIndex = 0`. Currently invisible only because
`expanded` is forced false on episode change (`:516`) — which is itself a defect for the
`startAt` case: an episode opened from *"eleven minutes on Romans 8"* lands **collapsed**, hiding
the transcript that justifies the jump.

### D13 — QA tour cannot pass

`scripts/qa-podcast-player.mjs:201-202` reads `.podcast-dock-publisher` / `.podcast-dock-passage`;
the component renders `.podcast-mast-source` / `.podcast-mast-passage` (`:732`, `:737`).
`assert.equal(playing.publisher, "Naked Bible Podcast")` at `:281` and
`assert.equal(playing.passage, PASSAGE)` at `:283` both compare against `undefined`.

---

## 5. Accessibility

- `<ul aria-label="Transcript">` (`:963-965`) of `<li><button>`. Every line is a tab stop —
  **2,280 tab stops** in a 380px dock, with no roving-tabindex, no skip, and no way to reach the
  currently-playing line by keyboard.
- `aria-current={index === lineIndex}` (`:657`) — correct, and **styled by nothing**. Screen-reader
  users get the position; sighted users get it only through `data-d="0"`, which search destroys (§3.3).
- **No announcement of position, seek, or follow state.** The only live region is the play/pause
  status at `:722-726`, correctly throttled to status changes. Nothing announces "following paused",
  "following resumed", "jumped to 42:17", or the search result count.
- **A screen-reader user cannot stop the autoscroll.** Virtual-cursor reading fires neither `wheel`
  nor `touchmove`, so `following` stays `true` and the container is scrolled under them every ~4 s
  for the length of the episode.
- `role="tablist"` / `role="tab"` / `aria-selected` at `:807-826` with **no `tabpanel`, no
  `aria-controls`, no roving tabindex, no arrow-key handling** — an incomplete ARIA tabs pattern,
  which is worse for AT than plain buttons.
- `"No line says that."` (`:972-974`) is not a live region; a search with no hits announces nothing.
- The clear button's accessible name is its text content, `"12 · clear"` (`:947`) — the middle dot
  is announced. Its explanation lives in a `title` (`:943`).
- The `auto` provenance chip (`:955-959`) is a bare `<span>` with a `title` — the machine-transcript
  disclosure, which the codebase treats as a hard requirement everywhere else, is not in the
  accessibility tree in any reliable form.
- **Focus on jump:** clicking a line focuses that button (native) and nothing else moves. Nothing
  moves focus to the active line on seek, so a keyboard user who seeks by any other control loses
  their place entirely.
- Focus ring: `:focus-visible` uses `var(--focus-ring, currentColor)` (`player.css:687`) —
  `--focus-ring` is also undefined in this codebase, so it resolves to `--resource-ink`; the
  `outline-offset: -2px` at `:688` beats the dock-wide `+2px` at `:180` by source order. Works, but
  by accident.
- `forced-colors` block (`:1180-1216`) covers the mast, chapters, transport and rail. It covers
  **nothing** in the transcript — not the lines, not `data-d`, not `mark`, not the Follow pill.

---

## 6. Design questions worth a decision — sharpest first

1. **Is a click a re-engagement of following?** The codebase already answered yes for passage rows
   (`:586-589`) and no for transcript lines and chapter rows. Both reference implementations answer
   yes everywhere. Pick one rule and apply it to all seven seek surfaces in the §1 table, including
   the scrub and the ±15/30 skips — a skip is also a statement about where the reader wants to be.

2. **Does selecting a search result exit the search?** Currently no, and there is no third state
   between "filtered list" and "full transcript." The alternative — keep the query, restore the full
   transcript, and mark hits in place with next/prev navigation — is the pattern Apple and Spotify
   use, and it is the one this surface's *own* `highlight()` function (`:93-107`) was written for.
   `highlight()` currently only ever runs inside the filtered list, where narrowing has already made
   it redundant. Somebody built the in-place-highlight primitive and then shipped the filter instead.

3. **Is following one state or two?** Right now `following` conflates "the transcript may move
   itself" with "the reader is at the playhead." Those come apart the moment you search, which is
   why `!searching` had to be bolted onto the pill's guard (`:980`) and why `searching` is missing
   from the effect's guard (`:631`). A `mode: "following" | "browsing" | "searching"` machine makes
   D2/D3 disappear rather than needing separate patches.

4. **What is the transcript's unit?** `readingLines` builds 10–16-word lines; the 40-character
   measure wraps each to 2–3 rows; the `data-d` ramp counts lines but the reader's eye counts rows;
   the box shows fewer than three legibly. Either the measure widens, or the target line length
   drops to fit one row, or the depth model stops being row-shaped. The three are currently
   inconsistent with each other.

5. **How does a reader navigate 2h18m of prose with no scrollbar, no timestamps and no structure?**
   Wayfinding was removed on purpose (`player.css:579-583`) and the argument is sound *for a reader
   who is following*. It is not sound for a reader who is browsing — which is the mode search puts
   them in and the mode the Follow pill exists to name.

6. **Should the transcript exist when the sheet is closed?** 2,280 buttons mount on play and
   reconcile every 4 s for an episode the reader may never expand. Virtualizing, or gating the
   render on `expanded`, decides itself once you decide whether the sheet is a panel or a page.

7. **Where does search live?** It is buried: expand the dock, and only if `view === "transcript"`.
   There is no keyboard route (grep of `ShortcutsOverlay.tsx` and `CommandPalette.tsx` for
   "podcast" or "transcript": zero hits). With 3,521 transcribed episodes on disk, whether
   transcript search is a per-episode filter or a library-wide surface is now a live product
   question, not a player detail — and the `text` field the pipeline writes, which the renderer
   currently discards at `core/transcripts.ts:203-234`, is the thing a library-wide search would
   need.

8. **The word-level timings are unused.** 24,995 timed words per episode are loaded, sorted,
   collapsed into lines, and then only `line.s` is ever read. Karaoke word highlighting — which is
   what iOS Apple Podcasts does and what most readers now expect — is available for free and is not
   drawn. Whether that is restraint or an omission is a decision nobody has recorded.

---

## Reference patterns (for contrast)

- **Apple Podcasts**: transcript auto-scrolls and highlights the spoken text; tapping any paragraph
  jumps playback to that point; the transcript keeps following from the current playback position
  after manual scrolling; a dedicated Search control at the bottom of the sheet finds words and
  taps jump to that point in the audio. iOS/iPadOS highlight **per word**; macOS does not.
- **Spotify**: transcript panel scrolls in sync; tapping any line jumps playback to that exact spot;
  highlighting is word-level ("Read Along").
- **YouTube**: the transcript panel scrolls in sync and clicking any line seeks to that moment.

The shared shape across all three: **following is the resting state, a click is always both a seek
and a re-sync, and the reader is never left inside a filter after choosing from it.** All three are
what this implementation departs from, and it departs from them only on the transcript-line path —
its own passage-row path already matches.

Sources:
- [View podcast transcripts on iPhone – Apple Support](https://support.apple.com/guide/iphone/view-podcast-transcripts-iph9426049e9/ios)
- [iOS 17.4: Using Apple's New Podcast Transcript Feature – MacRumors](https://www.macrumors.com/how-to/view-search-transcripts-podcasts-app/)
- [Spotify auto-generated transcripts – Android Police](https://www.androidpolice.com/spotify-auto-generated-transcripts-podcasts/)
- [Spotify AI time-synced podcast transcripts – AlternativeTo](https://alternativeto.net/news/2023/9/spotify-introduces-auto-generated-podcast-transcripts)
- [Opening a YouTube transcript – University of Derby](https://www.derby.ac.uk/digital-guidelines/accessibility/transcripts/how-to-open-a-transcript-and-toggle-timestamps-in-youtube.php)
