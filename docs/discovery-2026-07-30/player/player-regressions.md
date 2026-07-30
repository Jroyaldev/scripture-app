# The player after three builds — what got worse

Adversarial counter-audit of 9130779 (seek/follow machine), ff91d04 (app-owned
surface, publisher plate), 2c3ea53+f2bf41d (merged margin, passage links, walk).
BEFORE is 6565610, built in a detached worktree and driven through the same
states; AFTER is b480f3d as banked in `docs/ui-audit/podcast-player/`.

Capture roots:
- **B/** = `…/94f4876e-…/scratchpad/before-captures/`
- **A/** = `/Users/jonnyroyal/dev/scripture-app-quire/docs/ui-audit/podcast-player/`
- **A2/** = `…/94f4876e-…/scratchpad/after-captures/` (re-captures at b480f3d)

Four leads from the orchestrator's first pass are **refuted** below and replaced
with the mechanism that actually produces what it saw. Those are marked ⊘.

---

## 1 · REGRESSED

### R1 · The dock at rest no longer says what is playing — severity: high
**B/before-paper-dock.png** → **A/paper-dock.png**

Before, the loudest thing in the collapsed dock was the episode: *"Naked Bible
479: 1 Samuel 30-31"*, full, bold, unbroken, with *"1 Samuel 30"* complete in the
mast. After, the line reads **"worked through** Naked Bible 479: 1 S…" — the
relation word is bold serif and leads; the episode's name is gray and truncated;
and the mast's passage is truncated too (*"1 Samuel 30:1–…"*). Two ellipses in a
dock that previously had none.

`PodcastPlayer.tsx:2617-2631` is where this is chosen, and its own comment argues
the case: *"which of the four claims this is"* is what a reader cannot recover
once the sheet is shut. The argument is sound and the execution inverts it —
`relationSaid()` gets `--fw-semibold` serif at full ink while the title, the only
string that identifies the thing, is demoted to the secondary ramp and clipped.
The relation is a qualifier that has been given the weight of a subject.

Worse in the name-only case (5 of 11 shows): **A/paper-dock-unbranded.png** shows
*"NAKED BIBLE POD…"* truncated inside its own plate **and** *"1 Samuel 30:…"*
truncated beside it. A row whose whole job is identification truncates both
identifiers at once.

⊘ **Refuted:** "passage ellipsed in the mast chip even with spare room."
`.podcast-mast-passage` is `flex: 0 1 auto` with `margin-right: auto`
(`player.css:250-254`); an auto margin absorbs positive free space *before*
flex-shrink runs, so the ellipsis is proof the row was full, not proof of slack.
The real fault is the budget above it: `player.css:189-208` writes the yield
order down explicitly — *"1. the passage chip ellipses… 2. the plate shrinks…
3. nothing else"* — and gives the plate `max-width: 44%`. The reader's location
is ranked below the publisher's wordmark **by design**, in a dock that lives in
the ~450px margin lane. That is the finding, and it is stronger than the lead.

### R2 · A hovered line and the playing line are equally loud — severity: high
**A/paper-dock-sheet.png** (two lines both read as "current")

⊘ **Refuted:** "the active transcript line gained a gray fill." It did not.
`[data-d="0"]` is opacity 1 + a 0.34px text-shadow and no background
(`player.css:1198-1202`), and `[data-d="0"]:hover` explicitly sets
`background: none` (`player.css:1236`).

What the capture actually shows is `player.css:1230-1234`:
`.podcast-transcript-line:hover { background: var(--player-hover); opacity: 0.92;
filter: none; }`. Any line under the cursor is promoted to full sharpness *and*
given a fill — so with a mouse resting anywhere in the sheet there are two lines
competing to be the voice, and the one with the slab is the one that is **not**
playing. In A/paper-dock-sheet.png the true active line ("in it, both small and
great…") is crisp and unfilled while a filled slab sits directly under it.

The slab is also the same gray as the moment card's ground 400px above it
(A/paper-dock-sheet.png, the `1 Samuel 30:1–10 · worked through` block), so the
surface uses one fill for "this is the reader's declared moment" and for
"the pointer is here." Before, the same hover rule existed but painted
`color-mix(--resource-ink 9%)` on a dark publisher-coloured slab
(6565610:player.css:676-677) where it read as a pointer tint and there was no
moment card to collide with. Build 2 changed the ground under it and build 3 put
a competing slab on the same ground; neither revisited the rule.

### R3 · The depth ramp inverts at its own edge — severity: medium
`player.css:1206` vs `player.css:1216`

Distance 3 is `opacity: 0.22; filter: blur(1.9px)`. Distance 4-and-beyond is
`opacity: 0.22` with **no blur at all**. Same opacity, and the farther line is
*sharper* than the nearer one. Going forward from the voice the sequence is
1 → 0.5 → 0.32 → 0.22 → 0.22, with the last two steps distinguishable only by a
blur that runs the wrong way; going backward it is 1 → 0.5 → 0.4 → 0.3 → 0.22
(`player.css:1210-1211`). That visible seam is what reads as banding.

Before had no `:not([data-d])` rule at all — out-of-ramp lines simply stayed at
full opacity. Build 3 added the flat floor to fix that and produced the
discontinuity at the boundary in doing so. Net: better than before overall,
wrong at exactly one edge.

### R4 · The scrollbar sits on top of CLEAR — severity: high
**A/paper-dock-sheet-search.png**

The sheet's scrollbar (`.podcast-sheet-inner`, `overflow-y: auto;
scrollbar-width: thin`, `player.css:478-490`) draws over the sticky header stack.
In the capture it clips the right edge of the **CLEAR** button, cuts through
`10 min from 6:19` in the moment card, and crosses the tab tray. CLEAR is the
only way out of a search short of retyping, and part of its hit area is under a
scrollbar that scrolls a different thing.

Before, the sheet's children each owned their own scroll
(`player.css:470-477` records the change: *"Three children used to scroll
independently"*), so no single bar ran the height of the header. Build 2's "one
scroll for reading" is right, and it put the bar through the one control row.

### R5 · The sheet is legible-through while it opens — severity: medium
**A/paper-dock-reaching.png** — the Taught-here list ("Naked Bible 478: 1 Samuel
29 · 48s", "ELSEWHERE IN THE CHAPTER") is fully readable *through* the sheet's
own transcript text.

`player.css:491-501`: `.podcast-sheet-inner` opens from `opacity: 0` with a 60ms
delay over `--transport-quick`. So this is a transient, and the QA tour banked a
mid-fade frame as a truth capture — but the transient is new in kind. Before, the
sheet was an opaque dark slab over a light margin (**B/before-paper-dock-sheet.png**),
so a partial frame read unmistakably as a surface arriving. Build 2 made it cream
on cream: now the two texts are the same colour, the same face and the same size,
and for the length of the fade they interleave into nonsense.

### R6 · The publisher shelf lost its brands and its filter — severity: high
**B/before-margin-full.png** → **A/paper-margin-merged.png**

Before, the margin's Overview carried *"LOCAL PUBLISHER INDEX / Published
resources"*: six full-colour brand pills (Enter the Bible, Naked Bible,
40 Minutes in the OT, TGC, BibleProject, Spoken Gospel), an `All 10` control and
a filter button — then *"FROM THE TRANSCRIPTS / Taught here"* below it.

After, one section. `git diff` on `LivingMargin.tsx` shows
`<TrustedResourcesBlock … total hiddenCount catalogue onOpenSettings
onFiltersChanged />` deleted from the Overview tab; it survives at
`LivingMargin.tsx:4481, 4608, 4738` for link panes only. Gone with it from the
default tab: the colour shelf, the `All 10` affordance, the publisher filter, and
the route into resource settings (`app.tsx:2260`).

What replaces it is a monochrome plate repeated inline. In
**A/paper-margin-merged.png** four consecutive rows each carry an identical dark
`NAKED BIBLE` plate while "40 Minutes in the Old Testament" — which *does* have a
palette at `styles.css:20193-20205` — renders as plain gray text. Same kind of
row, two visual grammars, and the difference encodes nothing a reader can use.
Brand presence went from six colours in one glance to one plate stamped four
times.

### R7 · Transcript and margin can no longer be read together — severity: medium
**B/before-paper-dock-sheet-in-place.png** → **A/paper-dock-in-place.png**

The sheet is bottom-pinned and opens upward *over* the study panel — stated as
intent at `PodcastPlayer.tsx:1055-1059` (*"the sheet is an overlay above it…
Nothing outside this surface moves"*). The stability is real and the cost is
real: at `max-height: min(56vh, 520px)` (`player.css:480`) an open sheet covers
most of the margin, so "read the transcript while the passage list is open" is
now sequential where it used to be simultaneous.

### R8 · Less transcript per screen — severity: low
**B/before-paper-dock-sheet.png**: search box at 35% of sheet height.
**A/paper-dock-sheet.png**: search box at 44%. The added chrome is the
`Open at Naked Bible Podcast` link, a permanent two-line permission sentence
(*"Transcript machine-read from the published audio, with Naked Bible Podcast's
permission."*) and the moment card. The permission line is legal register in the
reading position, redrawn on every open, and it never changes.

### R9 · The reaching scrub handle pins to the far right — severity: medium
**A/paper-dock-reaching.png** — the amber fill sits at ~15% (the resumed
position) while the amber thumb sits hard against the right edge.

`PodcastPlayer.tsx:2716-2731`: `max={Math.max(1, Math.floor(of))}` with
`of === 0`, and `value={Math.floor(position)}` at 379. The range clamps 379 to a
max of 1, so the native thumb renders at 100%. Every resumed episode shows a
finished-looking scrubber for the whole time it is loading.

---

## 2 · HOW TO IMPROVE — smallest honest fix each

- **R1** — Swap the two ranks in `PodcastPlayer.tsx:2628-2631`: title at
  `--fw-semibold`/`--text-primary`, relation at `--text-tertiary` in the small UI
  face, unchanged in wording. Then drop `.podcast-mast-plate`'s `max-width` from
  44% to ~30% (`player.css:208`) so the passage ellipses only after the wordmark
  has yielded. One rank swap, one number.
- **R2** — Make hover a *border* rather than a fill and stop it clearing the
  blur: in `player.css:1230-1234` replace `background` with
  `box-shadow: inset 2px 0 0 var(--border-medium)` and delete `filter: none`.
  Sharpness then means "playing" and nothing else.
- **R3** — Give `:not([data-d])` the blur its neighbour has:
  `player.css:1216` → `{ opacity: 0.22; filter: blur(1.9px); }`. One declaration.
- **R4** — `scrollbar-gutter: stable` on `.podcast-sheet-inner` plus
  `padding-inline-end` on the sticky header rows (`player.css:478-490`), so the
  bar has a lane of its own and CLEAR is never under it.
- **R5** — Give `.podcast-sheet-inner` an opaque `background: var(--bg-float)`
  so the fade happens against paper rather than against the margin's text.
- **R6** — Restore the brand row as a header strip on `Taught here`: reuse the
  existing `TrustedResourcesBlock` catalogue/filter props above the bands rather
  than inline per row, and delete the per-row plate. One shelf of colour, one
  filter, rows stay quiet — and the asymmetry between plated and unplated
  publishers disappears with it.
- **R7** — Let the sheet's `max-height` fall to ~34vh while the margin's Study
  tab is open (`player.css:480`), or move the passage list out of the sheet and
  into `Taught here` where the reader already is.
- **R8** — Move the permission sentence to the sheet's foot, next to the AUTO
  mark it belongs with; it is a colophon, not a header.
- **R9** — `PodcastPlayer.tsx:2730` → `value={of > 0 ? Math.floor(position) : 0}`.

---

## 3 · NEVER FIXED — and which build owed it

| Item | State at b480f3d | Owner |
|---|---|---|
| `.podcast-chapters` corpse | **Still there.** `player.css:564` styles it; `PodcastPlayer.tsx:2374` renders it under `chapters.length > 0`; `chapters` comes from `episode?.chapters ?? []` (`:1541`) and the code's *own* comment at `:2700-2701` says the field is *"currently never supplied"* and *"no call site has ever supplied"* it. Build 3 diagnosed the corpse, routed the scrub ticks around it, and left it standing. | **2c3ea53** — it wrote the comment. |
| Library-wide search | **Never built.** Zero hits for any cross-episode search in `PodcastPlayer.tsx`, `api.ts`, `main.ts`. The box searches the open episode only. Build 3 indexed a whole chapter's corpus to build the walk and the merged margin — the data is right there — and the search stayed episode-local. | **2c3ea53**. |
| The walk's over-long invitation | **Fixed.** `TaughtHere.tsx:73-74` clamps to `WALK_STOPS = 12` and `WALK_FLOOR_SECONDS = 60`; the control declares count/order/total from one pass (`:242-260`, `:352-367`) and offers nothing below two stops. A/paper-margin-merged.png shows *"2 treatments · longest first · 47m"*. | closed by 2c3ea53 |
| Loading state has no visual truth | **Fixed, with R9 outstanding.** B/before-paper-dock-reaching.png is indistinguishable from playing — pause glyph, `6:21 · 1× · −37:31`, filled bar. A/paper-dock-reaching.png says *"length unknown until it loads"* and *"Reaching Naked Bible Podcast…"*; A/paper-dock-refused.png says *"Did not arrive. This needed the network."* | closed by 2c3ea53 |
| `--podcast-dock-h` ~2px trail | **Was never these builds' bug.** `git show 6565610:PodcastPlayer.tsx` already measures it (3 references), and the shut-only guard with its rationale is pre-existing (`PodcastPlayer.tsx:1064-1092`). `styles.css:388`'s `138px` is the documented fallback, not a trail. Nothing owes this. | ⊘ n/a |
| ⊘ Compact shell crushes the margin | **Pre-existing, not a regression.** `flex: 0 0 calc(var(--margin-header-h) + 44px)` is at `6565610:styles.css:5707` verbatim, and `.app-shell:has(.podcast-dock) .living-margin` with its dock-height reservation is at `6565610:styles.css:5661`. What the builds changed is the *dock's* height, which widens the dead band the reservation opens under an already-crushed pane — visible as the empty strip between the header-only margin and the dock in **A/paper-dock-narrow.png**. Real, but inherited. | **ff91d04** should have owned it — it re-founded the dock's relationship to the shell and never looked below 979px. |
| Footing copy is ops language | **Still ops language.** `TaughtHere.tsx:455-459` renders *"Machine-read from published audio. 1 of these 2 publishers gave permission; 1 has not been asked yet."* (A/paper-margin-merged.png, foot). "Has not been asked yet" is a fact about our outreach backlog stated on a reading surface. The rationale at `:442-454` argues correctly that the *distinction* must stay visible; it does not follow that our to-do list is the way to say it. | **2c3ea53** |

---

## 4 · COLLATERAL — what the changes hurt elsewhere

**C1 · The publisher link left the dock, and the refusal lost its way out.**
Before, the mast held three icons — chevron, open-at-publisher, close
(`6565610:PodcastPlayer.tsx:747, 764, 777`); see the ↗ glyph in
**B/before-paper-dock.png**. After, two (**A/paper-dock.png**). The link became a
sentence inside the sheet (`PodcastPlayer.tsx:2234`), and `player.css:150-152`
records why: *"the publisher's own page — moved into the sheet, where it can be a
sentence instead of a third glyph competing with the mark."* The reader's route
to the publisher was spent on the publisher's logo.

The bill lands on the refusal. `PodcastPlayer.tsx:2640` still tells the reader
*"The way out is the link that was always beside play"* — and
**A/paper-dock-refused.png** shows no link beside play. The escape hatch the
refusal copy is written around no longer exists in the state that needs it, and
the play button is drawn at full amber strength, inviting a press that will fail
the same way.

**C2 · A walk advance wipes the reader's work — and can shut the sheet on them.**
`PodcastPlayer.tsx:1150-1162` resets on `episodeId` alone:
`setExpanded(launchedAtMoment); setQuery(""); setMode("following");
setView("transcript"); setNotice("")`. The comment defends it on the ground that
*"the sheet is handed back closed, none of them was even visible."* That premise
holds for a card launch and fails for the walk build 3 added: when
`walkPastEnd()` advances (`PodcastPlayer.tsx:323, 2027`) the reader touched
nothing, and if the next stop is not a moment launch, `setExpanded(false)` **closes
an open sheet mid-read** while wiping the query, the view tab and the follow
state. A reader searching a transcript loses the search *and* the surface at the
end of a track. Severity: high — it is silent, and it is the one path where the
reader has no action to associate the loss with.

**C3 · The lock screen loses next/prev exactly when the queue ends.**
`PodcastPlayer.tsx:1980-1985` registers `previoustrack`/`nexttrack` only while
`walkActive`. The rationale (*"a system control that does nothing is worse than
one that is not there"*) is sound and I do not think it should be reverted — but
the effect is that the system panel's shape changes under the reader partway
through listening, and outside a walk there is still no next even though
`Taught here` is a list of exactly what the next thing would be. Build 3 built the
queue and stopped at the walk's edge.

**C4 · The merged margin scrolls its own kicker under the tab bar.**
**A/paper-margin-merged.png**, top: the *"TRANSCRIPTS AND PUBLISHER INDEX"*
kicker is half-visible behind the sticky Overview/Notes/Connections/Words row,
struck through by the active tab's gold seal. Before there were two shorter
sections with their own mastheads (**B/before-margin-full.png**); merging them
into one long section put a kicker in the sticky bar's path.

**C5 · Two tab idioms are on screen at once.**
The app's law is written at `styles.css:8506-8533`: transparent ground, ink
colour change, *"Law 2 · a 2px seal mark on the edge nearest the content it
opens"* in `--study-gold`. The sheet's switcher is a filled `--bg-float` pill
with a 1px ring on a `--player-hover` tray (`player.css:624-656`).
**A/paper-dock-in-place.png** has both in one frame, about 40px apart.
This is *not* a regression from 6565610 — the switcher was a segmented control
before too — but it was then the chrome of a dark, deliberately foreign surface.
ff91d04 made the surface app-owned and left the last foreign control on it.

**C6 · The follow pill parks on the transcript.**
**A/paper-dock-sheet-search.png**: the dark `↓ Follow | 6:12 back` pill sits over
a transcript line, hiding roughly half of it. It is the follow machine (9130779)
landing on the sheet build 2 later reshaped; nothing reserves a lane for it.

**C7 · A stray ring in the search row.**
**A/paper-dock-sheet-search.png**, between the query and the `‹ 1/34 ›` group: an
empty circular outline with no label and no evident state. Worth naming as noise
in a row that already carries five controls.

---

### Method note
BEFORE was built from a detached worktree at 6565610 with `node_modules`
symlinked from the main tree and driven on a throwaway user-data dir; the main
tree was never written to. No before-capture exists at ≤979px, and none was
needed: the compact-crush rules are byte-identical at 6565610
(`styles.css:5661, 5707`), which settles that question from git rather than from
a screenshot.
