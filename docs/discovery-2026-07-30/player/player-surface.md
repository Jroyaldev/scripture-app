# The podcast player as a designed object

Read-only discovery in `/Users/jonnyroyal/dev/scripture-app-quire` (branch `codex/quire-redesign`).
Nothing was built, run, or written in the repo. Every claim below is cited to file:line at HEAD `4a6a26c`.

Primary sources read in full: `src/renderer/components/PodcastPlayer.tsx` (1102 lines),
`src/renderer/styles/player.css` (1228 lines), the brand palette block
`src/renderer/styles.css:19640–19960`, the token block `src/renderer/styles.css:241–473`,
`scripts/qa-podcast-player.mjs` (508 lines, read not run), the card family
`src/renderer/styles.css:20419–20510` and `src/renderer/components/LivingMargin.tsx:411–830`.

---

## 0. The first thing the next agent needs to know

**There is no current visual truth for this surface.** All fifteen captures in
`docs/ui-audit/podcast-player/` were committed in `9a8dc12`, and every one of them shows a
cream, unbranded, paper-coloured dock (see `paper-dock.png`, `dark-dock.png`). But
`9a8dc12`'s own `src/renderer/styles/player.css:45–48` already painted the dock
`var(--resource-source)`, and `9a8dc12`'s own `styles.css` already listed `.podcast-dock` in
every brand palette selector. The captures in that commit do not correspond to the code in
that commit — they were taken against an earlier build and committed alongside.

Three further commits have since changed the surface without regenerating anything:
`1c9a4ee` (Spoken Gospel palette), `c62a8bf` (mast overflow), `e8e2ee9` (frame re-canon:
`--page-inset` 24 → 10, `--radius-page` 8 → 14). So the audit shows a dock with the wrong
ground, the wrong corner radius and the wrong inset.

`paper-dock-focus-mode.png` — committed in the same commit that introduced the minimised
disc (`git log -S "focus-mode .podcast-dock"` returns only `9a8dc12`) — shows the dock at
**full size** in focus mode. Either the disc did not fire in that run or the capture
predates the rule. Nobody has since produced a picture of the disc. Treat the
minimised-disc state (`player.css:967–1155`, ~190 lines, the most elaborate thing in the
file) as **unverified**.

The QA script is also stale in two places that would fail on the first run:
`scripts/qa-podcast-player.mjs:201–202` queries `.podcast-dock-publisher` and
`.podcast-dock-passage`, which exist nowhere in the source (the classes are
`.podcast-mast-source` / `.podcast-mast-passage`), and `:294` asserts
`rect.right === 24` when `--page-inset` is now `10px` (`styles.css:285`).

And the tour never opens the sheet. It captures fourteen states of the collapsed dock and
zero of the extended player: no transcript, no passage list, no tab strip, no search, no
"no transcript" state, no unbranded source, no translucent material, no forced colors.
**The entire extended form has never been captured or asserted.**

---

## 1. Inventory

### 1.1 States that exist in code

`PodcastStatus = "idle" | "reaching" | "playing" | "paused" | "failed"` — `PodcastPlayer.tsx:110`.
The dock renders only when an episode is loaded (`PodcastPlayer.tsx:706`).

| State | Where set | What is drawn differently | Verdict |
|---|---|---|---|
| **no episode** | `PodcastPlayer.tsx:706` | nothing at all — no surface exists | **undesigned**: there is no "nothing playing" affordance anywhere in the app, and therefore no way to resume the last episode |
| **idle** | `:247` (always with `episode: null`) | nothing — unreachable while the dock is drawn | **dead state** in the vocabulary |
| **reaching** | `:173`, `:201`, `:702` | travelling segment on the rail, but only when `of <= 0` (`:1072`); scrub track cleared (`player.css:940`) | **half-designed**, and it lies: `paused = status !== "playing" && status !== "reaching"` (`:566`) so while loading the button draws the **pause** bars and its label says "Pause" (`:1009`). Title and clock read the episode name and `0:00 / —:—`. |
| **playing** | `:700` | pause glyph, rail fills | designed |
| **paused** | `:696`, `:699` | play glyph | designed |
| **failed** | `:697` | one line of 10px text replaces the clock (`:1046`, `player.css:859–866`) | **under-designed**: `color: var(--resource-ink)` — the error has no error colour. `--error` is referenced nowhere in `player.css`. Ground, border, controls and rail are byte-identical to `paused`. The scrub stays enabled-looking. |
| **expanded** (the extended form) | `:418`, `:792` | the sheet | designed in parts, see below |
| **peeking** | `:454` | consumed only by the focus-mode selector (`player.css:1028`) | exists only inside the unverified disc state |
| **focus-mode disc** | `player.css:1028–1155` | 54px circle, conic ring, aim-cone hit area | **unverified** — never captured |
| **long title, collapsed** | `player.css:794–802` | one line, ellipsis, `title` attr (`:1038`) | designed |
| **long title, expanded** | — | `<h2>` wraps freely | **accident**, see 1.3 |
| **narrow width** | `player.css:1220–1227` | one query at 620px | **gap**: the app's own compact breakpoint is 979px (`styles.css:5673`), where `.living-margin` becomes a full-width bottom pane. The fixed 380px dock has no rule for that range and will sit on top of it. |

### 1.2 States the code carefully computes and then throws away

`transcript` is `Transcript | null | undefined` with a comment insisting the distinction is
load-bearing — *"'no transcript' is a fact worth drawing, and 'not looked yet' must not be
drawn as that fact"* (`PodcastPlayer.tsx:420–422`). Neither value draws anything. The
transcript block is gated on `transcript && lines.length > 0` (`:923`); `refs` has the same
`undefined | null` distinction (`:432`) and the same fate.

Worse, the two gates interact into a genuinely empty sheet. The tab strip requires **both**
references and transcript lines (`:806`). `view` initialises to `"transcript"` (`:430`). The
refs view is gated on `view === "passages"` (`:835`). So an episode **with references but
without a transcript** renders: no tabs, no refs (view is wrong and there is no control to
change it), no transcript. The extended player is `<h2>` + `<p>` and nothing else. Same for
the whole window while both fetches are in flight — which is every time the sheet is
opened.

### 1.3 The two elements with no CSS at all

`.podcast-episode-title` and `.podcast-episode-meta` (`PodcastPlayer.tsx:795–799`) have **no
rules**. The only occurrence of either class name in any stylesheet is the forced-colors
block at `player.css:1189–1190`, which sets `color: CanvasText` — someone believed they were
styled. With the global reset zeroing margins (`styles.css:1009`), the `<h2>` renders at the
UA's `1.5em` bold — 24px in `--font-ui` — and the `<p>` at 16px, both at full-strength
`--resource-ink`.

Consequences: the episode title in the sheet is **the largest type in the entire study
column** (`.trusted-resources-masthead h3` is `1rem` bold, `styles.css:19586`), set in the UI
sans rather than the reading serif every other title uses, with no `text-wrap`, no clamp and
no max lines. On a long episode name it wraps to three or four 24px lines and grows the dock
upward, which drives `--podcast-dock-h`, which re-lays out the study panel and the toast lane.

### 1.4 A whole designed sub-state that never renders

`PodcastEpisode.chapters` is documented as *"Optional, and currently never supplied"*
(`PodcastPlayer.tsx:73`). That makes dead-on-arrival: `.podcast-chapters` (`player.css:217`),
`.podcast-chapter` + `-time` + `-ref` + `-title` (`236–260`, `704–725`), `.podcast-rail-tick`
(`885`), the `.podcast-dock-now` / `-now-ref` / `-now-title` variant of the dock line
(`804–824`), and the `expanded && chapter` branch (`PodcastPlayer.tsx:1027–1036`). Roughly
90 lines of CSS and a second dock-line composition no reader has ever seen.

Note this is also where `--resource-pill-bg` / `--resource-pill-ink` are used inside the
sheet (`player.css:720–723`) — so in practice the publisher's pill pair is consumed by exactly
two live things: the play button and the rail fill.

### 1.5 A control that lies about the file

`rateIndex` is component state (`PodcastPlayer.tsx:433`) and the episode-change effect
(`:515–519`) resets only `expanded` and `peeking`. `playPodcastEpisode` assigns
`transport.src` (`:171`), which runs the media load algorithm and resets `playbackRate` to
`defaultPlaybackRate` (1). So after switching episodes the dock reads `1.5×` while the file
plays at `1×`. `preservesPitch` is likewise only ever set inside `setPodcastRate` (`:229–233`),
so it is never set at the default rate.

---

## 2. Shape

The canon: *"Radius ≈ 0.22 × the element's shorter dimension, rounded even, capped at 8"*
(`styles.css:398–404`), one documented exception. Shadows: *"Docked things use a hairline.
Only floating things cast a shadow, and there is exactly one"* (`styles.css:421–422`).

### 2.1 Eight corner values on one 380px surface, one of them derived

| Value | Where | Against canon |
|---|---|---|
| `--radius-page` 14 | dock (`player.css:42`) | the card that spawns it takes `--radius-lg` 12 (`styles.css:19888`); cards are supposed to nest at `--radius-md` 8 (`styles.css:416`). Three values in one family. |
| `--radius-page` 14 | imprint chip, 30px tall (`styles.css:19621`) | 0.22 × 30 = 6.6. It read 8 before `e8e2ee9` and became a near-pill silently when the token moved. |
| `--radius-pebble` 4 | mast icon 24px (`166`), chapter row (`244`), views tray (`270`), ref row (`379`), transcript line (`630`) | canon says ~5 for a 24px box, ~7–8 for a 36–40px row |
| `calc(--radius-pebble - 2px)` = 2 | view tab (`282`) | **the only derived radius on the surface** |
| `3px` hardcoded | view count (`299`), transcript-clear (`312`), transcript-auto (`507`) | belongs to no token |
| `2px` hardcoded | `mark` highlight (`572`) | should be `--radius-mark` |
| `--radius-mark` 2 | rate button (`842`) | fine |
| `999px` | follow pill (`541`), scrub track (`910`), reaching bar (`953`) | fine |
| `50%` | skip (`753`), play (`774`), thumb (`925`), disc (`1043`) | fine |

### 2.2 Shadows: the canon says one; the family carries seven

- dock: `--shadow-elevated` (`player.css:48`) — correct.
- `.podcast-transcript-follow`: `0 3px 12px -4px rgb(0 0 0 / 45%)` (`548`) — a hardcoded
  second shadow **inside** the surface that already casts the one.
- scrub thumb: `box-shadow: 0 0 0 2px var(--resource-source)` (`927`) — a third box-shadow idiom.
- focus-mode disc: `box-shadow: none` (`1044`) — the app's only floating surface with no
  elevation, so the minimised player has no separation from the reading paper at all.
- card family, same brand, adjacent in time: `.trusted-resource-imprint:hover`
  `0 4px 10px -5px` (`styles.css:19628`), `[aria-expanded=true]` a double ring (`19633`),
  `.trusted-resource-act:hover` `0 4px 10px -4px` (`20502`).

`--shadow-elevated` is theme-aware (`styles.css:425 / 739 / 925`) and is cast by a surface
that deliberately is not. On Ink, a `#dfeaf8` pale-blue Listener's Commentary dock casts a
34%-black shadow.

### 2.3 How the dock meets the page and the margin

`player.css:25–36` claims the dock is *"inscribed in the study panel's own footprint —
the same width, on the same right edge, at the same bottom inset."* The dock is
`position: fixed; right/bottom: var(--page-inset)` with
`width: min(var(--margin-width), …)`. `.living-margin` is
`width: var(--margin-width); min-width: 320px; max-width: 420px` reaching its right edge via
`margin-left: auto` (`styles.css:5615–5617`). **Nothing ties them.** The claim holds only
while the panel is exactly 380px; at either clamp the two disagree, and a fixed element
cannot follow.

The larger unanswered question: the dock is drawn **whether or not the panel exists**. With
the margin closed (which `player.css:60–70` explicitly handles) it is a 380px brand card
floating over the reading paper, in a column that is not there. The whole "stacked pieces of
one column" argument evaporates and no other shape takes its place.

Three hardcoded lane heights read the *other* dock's geometry — `104px`, `144px`, `74px`
(`player.css:60–70`) — while this dock measures its own with a ResizeObserver
(`PodcastPlayer.tsx:475–491`). One surface, two theories of how to know a height.

`--podcast-dock-h` is published to the shell and consumed by the study panel
(`styles.css:5644`) and the toast lane (`styles.css:7964`). Correct, and it means **opening
the sheet shortens the study panel by several hundred pixels and moves every toast**, in a
300ms grid animation, mid-scroll, with nothing damping it.

There is **no `max-height` on `.podcast-dock`**. Chapters 196 (`218`) + refs 300 (`338`) +
transcript 340 (`588`) + episode block + mast + body + rail can exceed a short window; the
dock's `overflow: hidden` (`51`) then clips the masthead off the top of the screen — and the
masthead is where the close button lives.

### 2.4 The alignment grid: four vertical edges, none derived

| Band | Rule | Left content edge | Right content edge |
|---|---|---|---|
| dock box | `padding: 0 16px` (`39`) | 16 | 16 |
| masthead | `margin: 0 -16px; padding: 13px 12px 12px 16px` (`95–96`) | 16 | **12** |
| body | `padding: 16px 0 15px` (`737`) | 16 | 16 |
| rail | `margin: 0 -7px 6px` (`879`) | **9** | **9** |

Vertical rhythm is 13/12, 16/15, 6 — near-misses. **`player.css` uses zero spacing tokens**
(`grep -c -- "--sp-" src/renderer/styles/player.css` → `0`), while the adjacent card family
was explicitly moved onto the 4px grid (`styles.css:19601`). Gaps in the file: 15, 11, 9, 8,
7, 6, 5, 3, 2. Max-heights: 196, 300, 340. Masks: 34, 18. None of it is a token and almost
none of it is a multiple of 4.

---

## 3. Controls

### 3.1 Geometry — three sizes, no scale

Mast icons **24×24** (`161–163`), transport skips **28×28** (`749–750`), play **38×38**
(`769–770`), scrub hit band 12 over a 4px rule (`876–905`), thumb 10 (`921`), rate ≈14 tall
(`840`), view tab ≈21 tall, transcript-clear ≈16 tall. Nothing below 44px anywhere; the
smallest interactive target is 24px, and the seek head is 10px.

### 3.2 Iconography — three grids, five rendered sizes, three stroke weights

| Glyph | Grid | Rendered | Technique |
|---|---|---|---|
| play / pause | 18 | 16 | fill |
| skip ±15/30 | 24 | 21 | 1.5 stroke ring + fill arrowhead + **live text node** |
| chevron / external / close | 16 | 13 | 1.5 stroke |
| search glass | 16 | 13 | 1.4 stroke (`player.css:463`) |
| follow arrow | 16 | 11 | 1.6 stroke (`557`) |

`SkipGlyph` puts a real `<text>` element inside the icon with
`fontFamily="var(--font-mono)" fontSize="9.4"` (`PodcastPlayer.tsx:379–388`). It is the only
place in the app that sets type inside an icon; it is subject to font loading, and it does
not participate in the app's type scale.

**The optical-centring correction was never carried across.** `PodcastPlayer.tsx:335–342`
documents at length why the dock's play triangle must be centroid-centred, and `M6 3.4 15 9l-9 5.6z`
on an 18-box does land its centroid on 9. The card's copy of the same glyph
(`LivingMargin.tsx:803–805`) is `M4.6 2.8 12.6 8l-8 5.2z` on a 16-box: centroid x = 7.27
against a box centre of 8. Its pause bars (`:800`) *are* symmetric about 8. So on the card,
play and pause shift 0.73px under the pointer — the exact defect the dock's comment says it
fixed.

### 3.3 Two transports for the same action on the same brand

| | dock | card |
|---|---|---|
| play button | 38px, **filled** `--resource-pill-bg` (`player.css:766–776`) | 28px, **hairline** `--resource-line` on transparent (`styles.css:20419–20431`) |
| focus ring | `--resource-ink` (`player.css:178`) | `--accent-seal` (`styles.css:20435`) |
| hover | `scale(1.05)` + `brightness(1.05)` (`781`) | `background: var(--resource-line)` (`20433`) |
| transitions | `--transition-fast` | hardcoded `150ms ease` (`20430`) |

There is also a **third, dead** transport: `.trusted-resource-scrub`, `-scrub-range`
(with an always-visible 11px thumb), `-scrub-time` at `styles.css:20437–20470`. No component
references any of them (`grep -rn "trusted-resource-scrub" src/renderer/` → CSS only). ~30
lines of a rival scrub aesthetic still in the bundle.

And a **fourth** surface that plays audio with no transport at all: `TaughtHereBlock`
(`LivingMargin.tsx:411–517`). Its rows are bare buttons that call `onPlay` (`:458–470`) with
no play glyph, no `aria-pressed`, no running state, no publisher colour. This is the surface
the 41,426 reference-moments land in — the one most likely to be pressed — and it has **zero
relationship** to the player's visual language. (Its `:hover { opacity: 1 }` at
`styles.css:19476` is also a no-op: nothing sets opacity < 1 on that row, and its comment
describes a "four-rung ladder" that no longer exists.)

### 3.4 Hover / active / focus / disabled

**Hover** is one idea — ink over brand — expressed as `color-mix(in srgb, var(--resource-ink)
N%, transparent)` at **eleven distinct alpha steps**: 8 (`271`), 9 (`508`, `677`), 10 (`388`),
11 (`253`), 12 (`313`), 14 (`174`, `852`), 15 (`291`), 20 (`322`), 22 (`1050`), 24 (`914`).

**Active/pressed** exists on exactly two controls, at two different depths:
`scale(0.94)` on skip (`761`), `scale(0.97)` on play (`782`). The mast icons, the rate, the
tabs, the reference rows and the transcript lines all have hover and **no press state**.

**Focus.** `.podcast-dock :focus-visible { outline: 2px solid var(--resource-ink) }` (`178`) —
the dock rings in the publisher's ink while its own card rings in the app's seal gold. And
`.podcast-transcript-line:focus-visible` uses `var(--focus-ring, currentColor)` (`687`) —
**`--focus-ring` is declared nowhere in the bundle**, so that ring is `currentColor` by
accident. (`--surface-page` is likewise a phantom: used at `styles.css:19616`, `19650` and
`player.css:543`, defined nowhere.)

**Disabled** is one line in the whole file: `.podcast-scrub:disabled { cursor: default }`
(`938`). A disabled scrub still paints its full track (`907–916`) unless
`data-status="reaching"` (`940`), so a seek bar that cannot be dragged is visually identical
to one that can.

**Touch.** The scrub head is `opacity: 0` until `.podcast-dock:hover` (`920–935`), with no
`@media (hover: none)` fallback — on a trackpad-less input the seek control is an
unlabelled rule.

### 3.5 What reads as "default HTML with paint"

- `input[type=range]` styled with `::-webkit-slider-runnable-track` /
  `::-webkit-slider-thumb` only (`907–935`), with `margin-top: -3px` and `margin-top: 4px`
  fudges to line a native thumb up with a hand-drawn track.
- `input[type=search]` with `-webkit-appearance: none` on the cancel button and a
  hand-rolled mask-composite ring (`488–499`).
- The `<h2>` and `<p>` in the sheet, which are literally unstyled UA elements.
- `role="tablist"` + `role="tab"` (`PodcastPlayer.tsx:807–826`) with no `aria-controls`, no
  `role="tabpanel"`, no ids, no roving tabindex. It is a tab strip in name only; `aria-selected`
  is doing the styling.
- The transcript set at `1.0625rem` (17px) `--font-reading` (`635`) inside a 348px column —
  roughly a 40-character measure for reading-size serif, in a piece of chrome.

### 3.6 What is missing entirely

No volume control. No `MediaSession` metadata anywhere (`grep -rn "mediaSession"` → nothing),
so macOS Now Playing and the hardware media keys are dead. No global play/pause key —
`togglePodcast` has no caller outside its own component. The only way to pause 3,521
episodes' worth of audio is to find a 38px circle that may currently be a 54px disc in a
corner.

---

## 4. Motion

### 4.1 The full inventory

| What | Duration / curve | Where |
|---|---|---|
| dock entry | 200ms `cubic-bezier(0.16, 1, 0.3, 1)` | `player.css:52`, `72–75` |
| sheet height | 300ms `cubic-bezier(0.2, 0.8, 0.2, 1)` | `191` |
| sheet contents | 190ms `ease` (opacity, +60ms delay) / 300ms same curve (transform) | `205–206`, `212` |
| transcript line depth | 460ms `cubic-bezier(0.25, 0.9, 0.3, 1)` | `643–644` |
| follow pill | 260ms `cubic-bezier(0.2, 0.9, 0.3, 1)` | `549`, `564–567` |
| loading segment | 1100ms `linear infinite` | `964` |
| focus-mode box + children | `--transition-normal` (180ms), opacity 140ms `ease` | `990–1022` |
| every hover | `--transition-fast` (120ms) | 23 uses |
| peek intent | 160ms in / 130ms out, in JS | `PodcastPlayer.tsx:504` |

The canon is two curves and *"everything else does not move at all"*, with
`--transition-slow: 0ms` (`styles.css:432–440`). The player adds **five bespoke curves and
eight bespoke durations** and is by a distance the largest motion vocabulary in the app.

### 4.2 The one loading device is borrowed from another partial

`player.css:1–6` declares itself the owner of this surface. `player.css:964` animates
`seal-progress-travel`, which is defined in **`src/renderer/styles/marking-actions.css:518`**.
An undefined `animation-name` fails silently, so the player's only loading device is one
rename away from a static bar. The comments at `944–945` and `1069–1071` also claim it is
*"the app's one loading device"*; there are five (`import-progress` `styles.css:7024`,
`toast-progress` `8085`, `rail-progress` `14304`, `search-progress-travel`
`search.css:37` — a near-duplicate of the same travelling segment at 34%/1.6s instead of
28%/1.1s — and `seal-progress-travel`).

### 4.3 What has no motion design at all

- **play ↔ pause**: two SVG paths swapped on render (`PodcastPlayer.tsx:343–353`). Hard cut.
- **status transitions**: `idle → reaching → playing → paused → failed` have no transition
  anywhere. The refusal line replaces the clock by element swap (`:1040–1064`).
- **episode change**: `--resource-source` changes from e.g. `#239948` to `#6d1409` with no
  transition on `background` (`player.css:45–47`). The whole surface changes colour in one
  frame while a title and a mast mark are replaced under it.
- **the rail fill**: `--podcast-played` is an inline custom property updated ~4×/sec
  (`PodcastPlayer.tsx:718`) driving a gradient stop with no transition — it steps.
- **collapsed ↔ expanded dock line**: `.podcast-dock-now` and `.podcast-dock-title` are
  different elements swapped by a ternary (`:1027–1039`).
- **exit**: `podcast-dock-in` has no counterpart. `stopPodcast` unmounts instantly.

### 4.4 Reduced motion

Covered at `player.css:575–577`, `693–702`, `1157–1178` — thorough for the dock's own
transitions.

Not covered: **`activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })`
at `PodcastPlayer.tsx:633`** is a JS-specified smooth scroll. `scroll-behavior: auto` (`694`)
cannot override an explicit `behavior` option, so under `prefers-reduced-motion` the
transcript still animates its scroll — the single largest movement on the surface, firing
once every four seconds while an episode plays.

Also not covered: `.podcast-ref` background transition (`384`), `.podcast-view-tab` (`287`),
and — in the same brand family — `.trusted-resource-imprint:hover { transform: translateY(-1px) }`
(`styles.css:19629`) and `.trusted-resource-act:hover` (`20501`), neither of which has a
reduced-motion rule (only `.trusted-resource-play` does, `20473`).

---

## 5. Brand presentation

### 5.1 The default palette is broken in two of four themes

`styles.css:19652–19669` gives any source without an explicit block:
`--resource-source: var(--study-gold)`, `--resource-ink: var(--text-primary)`,
`--resource-pill-bg: var(--text-primary)`, `--resource-pill-ink: var(--surface-page, #fff)`.

`--surface-page` is **defined nowhere**, so the pill ink is always `#fff`.

- Paper: `#322F2B` ink on `#96684A` ground ≈ 3.4:1 — below the floor Law 6 holds everything
  else to, on the fallback nobody chose.
- **Ink**: `--resource-ink: #EDE8E0` on `--resource-source: #C99A6E` ≈ 1.9:1, and the play
  button is `#EDE8E0` filled with a `#fff` glyph — **an invisible play button**.
- **Onyx**: `#E9E9EC` on `#C99A6E`, same white-on-white glyph.

All eight ingested shows currently have explicit blocks (`styles.css:19671–19884`), so this is
latent — but it is one feed away, and the ingest pipeline exists precisely to add feeds.

### 5.2 The material treatment only reaches half the shelf

`player.css:45–47` lays `radial-gradient(128% 88% at 14% 0%, rgb(255 255 255 / 0.10), transparent 62%)`
over the brand fill so *"a flat brand fill reads as a surface with a light on it."* On the
two light grounds — `enter-the-bible #fed141`, `listeners-commentary #dfeaf8` — white at 10%
is invisible. Eight docks are surfaces with a light on them; two are swatches.

### 5.3 The mark/no-mark split shows up as a typographic accident

Six sources swap the name for an image (`styles.css:19940–19951`); five keep the name in type
at `0.6875rem` uppercase, `0.055em` tracking (`player.css:103–112`). So the masthead is
either an 18–22px image or an 11px letterspaced label — not the same object at the same
optical weight, in a row whose `gap: 11px` and `min-height: 30px` were tuned for the image.
Immediately beside it, `.podcast-mast-kind` sets `podcast` in `--font-mono` at `0.59375rem`
with `0.13em` tracking (`124–130`). Beside a mark that reads as a caption; beside a name in
near-identical uppercase small type it reads as the second half of one label:
`40 MINUTES IN THE OLD TESTAMENT  PODCAST`.

### 5.4 Where the overflow fixes are cures and where they are bandages

`c62a8bf` added `min-width: 0` to `.podcast-mast` (`93`) and `.podcast-mast-source` (`105`),
and `overflow-x: clip` to the three scroll containers (`228`, `346`, `598`).

**Cures**: `overflow-x: clip` is the right fix and the commit's own reasoning is correct —
it closes the axis rather than removing one cause of a symptom that has now arrived twice by
two different routes.

**Bandages**: `min-width: 0` stops the row bursting; it does not decide what the masthead
should show when it cannot show everything. `.podcast-mast-source` is `flex: 0 1 auto` while
`.podcast-mast-passage` has `margin-right: auto` (`132–140`), so the publisher's name loses
characters before the passage chip loses any. The designed outcome for the source with the
longest name **and** no mark is `40 MINUTES IN THE OLD TES…`. Nothing establishes a width
budget between the four things in that row.

### 5.5 Contrast compounds and nobody computed it

Every `--resource-ink-soft` is already the ink at 0.72–0.78 alpha over the brand ground.
Then: `.podcast-ref-why` × 0.62 (`436`), `.podcast-refs-head` × 0.7 (`367`),
`.podcast-ref-time` × 0.65 (`399`), `.podcast-ref-extent` × 0.75 (`423`),
`.podcast-transcript-glass` × 0.55 (`466`), `.podcast-dock-clock-rest` × 0.72 (`837`).
`.podcast-ref-why` on `five-minutes-church-history` is `#eef4f2` at 0.76 over `#45696a`, then
× 0.62 — roughly 2:1. These were dialled by eye on one brand and applied to ten.

### 5.6 Forced colors

`player.css:1180–1216` covers the dock, the mast rule, seven text classes, four button
classes, the current chapter, the focus ring, and the scrub track and thumb. Not covered:

- `.podcast-views` / `-view-tab` / `-view-count` — the selected tab's only signal is a
  `color-mix` background, so **which tab is selected becomes invisible**.
- All of `.podcast-ref*`, `.podcast-refs-head`, `.podcast-mast-passage`, `.podcast-dock-refusal`.
- **`.podcast-transcript-line`'s `filter: blur()` ladder** (`659–672`) — `filter` and
  `opacity` are not forced properties, so a high-contrast reader gets text at 22% opacity
  and 1.9px of blur. The reduced-motion block flattens this (`693–702`); forced-colors does not.
- `.podcast-transcript-follow` — `background: var(--resource-ink)`, a hardcoded brand hex
  floating over a `Canvas` ground.
- `.podcast-rail-tick` — a brand-hex `background` painted over a forced `ButtonText` track.
- `.podcast-rail-reaching` and its `::after`.
- The focus-mode disc's `conic-gradient` ring (`1046–1051`) — a `background-image`, which
  forced-colors does not touch, so the minimised player keeps a brand-coloured ring on an
  otherwise system-coloured surface.

---

## 6. The "guising as polish" list

Each item: what it looks like, what it actually is, why it is unresolved.

**1. The commentary.** *Looks like*: the most thoroughly reasoned surface in the codebase —
every value has a paragraph defending it. *Actually is*: the prose is load-bearing where the
CSS is not. `player.css:944` says "the app's one loading device" (there are five, and this
one's keyframe lives in another partial). `player.css:25–30` says the dock is inscribed in
the panel's footprint (nothing ties them; a fixed element cannot follow a clamped one).
`PodcastPlayer.tsx:420` says "no transcript" is a fact worth drawing (it is never drawn).
`PodcastPlayer.tsx:335` documents an optical correction that its sibling glyph never got.
*Unresolved because*: the arguments were written once and the code moved underneath them, and
prose does not fail a build.

**2. The overflow fixes.** *Looks like*: the wiggle was found and closed at the axis, twice,
with a general remedy. *Actually is*: two correct bug fixes (`min-width: 0`, `overflow-x: clip`)
standing in for a masthead layout that has never had a width budget. *Unresolved because*:
the fix removes the failure mode and leaves the composition question — what a 380px row shows
when a mark, a name, a kind, a passage and three icons all want the same line — entirely open.

**3. `--podcast-dock-h`.** *Looks like*: a measured, honest number replacing a guess.
*Actually is*: a correct measurement wired to a violent consequence — opening the sheet now
shortens the study panel by several hundred pixels and relocates the toast lane, in one
300ms grid transition, with nothing damping either. *Unresolved because*: the constant was
wrong and the measurement is right, but nobody designed what happens to the panel when the
number triples.

**4. The focus-mode disc.** *Looks like*: the most considered thing in the file — Fitts's law,
an aim cone, a conic played-ring, two paint boxes, an intent pair split between JS and CSS,
190 lines. *Actually is*: unverified. The one capture of the state, committed in the same
commit as the rule, shows the dock at full size. *Unresolved because*: nobody has looked at
it since it was written, and the QA tour that would have caught it captures the state without
asserting anything about its size.

**5. The extended player.** *Looks like*: a full second surface — transcript with a depth
ladder, dual passage lists with evidence lines, search with a match count, a follow pill, a
view switcher. *Actually is*: two of its five blocks are unstyled UA elements, one whole
block (chapters, ~90 lines) can never render, one common data shape (refs without transcript,
or either still loading) renders an empty sheet, and none of it has ever been captured or
asserted. *Unresolved because*: the sheet grew feature by feature and was never composed as
one object or looked at as one picture.

**6. `.podcast-transcript-line`'s depth ladder.** *Looks like*: the best idea on the surface
— optical weight via `text-shadow` so nothing re-wraps, blur as depth, capped under 2px, four
distance steps, a past/future asymmetry, and a `NO TRANSFORM ON THIS ELEMENT, EVER` warning
earned by a real bug. *Actually is*: it deliberately blurs and fades body text and does not
opt out in forced-colors, where the readers most likely to be there are the ones who need it
least blurred. Its 460ms curve is also the slowest thing in the app by a factor of two and
belongs to no token. *Unresolved because*: the treatment was designed for one condition
(sighted, following audio, default colours) and never asked what the other conditions want.

**7. The transport.** *Looks like*: a considered iconography — an optically-centred play, an
arrow bent round its own interval, geometry defended to two decimal places. *Actually is*:
three icon grids (16/18/24), five rendered sizes, three stroke weights, a text node inside an
icon, and a rival play button 20px away on the card it was launched from, in the opposite
treatment (hairline vs filled), the opposite focus colour, and with the optical correction
missing. *Unresolved because*: the dock's controls were designed as a set and the card's were
designed earlier as a different set, and the two have never been reconciled even though the
same reader sees both in the same column within one second.

**8. The refusal line.** *Looks like*: an error state with a stated design position — name
the thing, the reason, and whether it was ours; keep it on one line so a failure does not
change the dock's height; it is even contract-tested for clipping (`qa-podcast-player.mjs:483–486`).
*Actually is*: 10px of `--resource-ink` — the same colour as everything else on the surface —
on a dock that is otherwise byte-identical to `paused`. The audit capture shows it in red;
the current CSS has no error colour at all. *Unresolved because*: the sentence was designed
and the state was not.

**9. The rate control.** *Looks like*: a considered cycle with 1× first so one press always
returns to normal, and `preservesPitch` set explicitly against a future engine default.
*Actually is*: a label that goes out of sync with the file on every episode change, and a
`preservesPitch` that is only ever set once the reader has already cycled away from 1×.
*Unresolved because*: the reasoning was about the rates, not about the lifetime of the state
holding them.

**10. The audit itself.** *Looks like*: fifteen captures across four themes and eleven
states, a 508-line QA tour that plays a real file from a real publisher and asserts CSP
refusal, element count, `preload`, lane geometry and F6 reachability. *Actually is*: captures
of a surface that no longer exists, two selectors that no longer resolve, one geometry
assertion that the frame re-canon invalidated, and no coverage of the extended form, the
unbranded fallback, the translucent material or forced colors. *Unresolved because*: the tour
was written for the *permission* boundary — which it still guards well — and has been asked
since to stand in for visual truth, which it was never built to carry.

---

## 7. Design questions worth a decision — sharpest first

**1. What is the dock's relationship to the study panel when the panel is not there?**
Every geometric argument in `player.css:25–36` derives the dock from the panel's column. With
the margin closed the dock is a 380px brand card floating over reading paper in a column that
does not exist — and that is the configuration focus mode puts a reader in. Either the dock
belongs to the panel (and should leave, or dock elsewhere, when the panel does) or it is an
independent floating object (and its width, radius and inset should be derived from something
that is always present). It currently claims the first and behaves like the second.

**2. Does the publisher own the surface, or the app?**
The dock is a brand-coloured card that changes ground colour with every episode, inside a
frame whose entire argument is two planes and a hairline. Ten hardcoded palettes × four
atmospheres × forced colors is 44 conditions that nobody can verify, and the evidence is
already there that it does not hold: the light-ground brands lose the material treatment, the
default palette is unreadable in two themes, the mark/no-mark split reads as a typographic
accident, and six alphas compound past 2:1 on at least one show. The alternative — the app's
own surface with the brand carried as a mark and one accent — is a smaller, checkable
problem. This decision governs most of section 5 and much of section 2.

**3. Where does a reader see the transport when they are not looking at it?**
Three thousand five hundred episodes and forty-one thousand moments means the player will be
running most of the time, and the app currently gives it: no MediaSession, no global key, no
"nothing playing" surface, no way to resume, and a stop button inside a card that in focus
mode is a 54px disc in a corner. This is a product question the shape questions depend on.

**4. Is the extended form a sheet on the dock, or a place?**
Today it is a growing card anchored to a corner: no max-height, no scroll of its own, three
independently-scrolling children with three different mask treatments, an unstyled 24px
heading, a tab strip that vanishes when either of its two feeds is missing, and a growth
mechanism that re-lays out two other surfaces. A transcript with search over 3,521 episodes
is a place, not a disclosure. Deciding which it is settles the empty states, the max-height,
the tab strip and the panel-reservation problem at once.

**5. What is the transport's control language, and does the card speak it?**
Two play buttons for one action, twenty pixels apart, in opposite treatments with different
focus colours and a missing optical correction — plus a third, dead scrub aesthetic still in
the bundle and a fourth surface (`TaughtHereBlock`) that starts audio with no transport
affordance at all. One decision: is the filled 38px pill the app's play, and does everything
that starts audio inherit from it?

**6. What is the app's motion vocabulary, and is the player allowed its own?**
The canon says two curves, 120 and 180, and everything else is still. The player ships five
curves and eight durations and is the app's only surface with a real motion identity — and
its most important transitions (play/pause, status, episode change, rail fill) have no motion
at all, while its least important (a hover pill) has a bespoke spring. Either the canon
expands to name a "transport" tier, or the player comes back inside it.

**7. What does the surface say while it is waiting?**
`reaching` currently draws a pause button, a zeroed clock, and a travelling bar that only
appears when duration is still unknown. The sheet draws nothing at all while two fetches are
in flight. Loading is the state a reader on a publisher's server will see most, and it is the
least designed one on the surface.

**8. Which corner does this family use?**
14 (dock), 12 (featured card), 14 (imprint chip, formerly 8), 8 (canon for nested cards), 4
(every row), 3 (three chips), 2 (one mark, one rate). The concentric argument in
`styles.css:398–419` is good and the player does not use it — one derived radius in the whole
file. A single decision about what a floating brand card is, and what nests inside it, would
collapse eight values to three.

**9. Do the four vertical edges become one?**
16 / 12 / 9 across three bands, with zero spacing tokens in the file. The rail's `-7px`
margin in particular is a magic number that puts the surface's widest element on an edge
nothing else shares.

**10. What is an error worth here?**
A refusal currently costs 10px of body-coloured text on an unchanged surface. Given that the
audio comes from someone else's server over a network the app does not control, the failure
state deserves a decision about how much of the surface it is allowed to change — including
whether it may change the dock's height, which the QA currently forbids
(`qa-podcast-player.mjs:486`).
