# `/magic` visual audit

Date: 2026-08-02  
Scope: Tour Lab visual direction and performance only. Search, retrieval, corpus ranking, and a main-app
port are outside this audit.

## Intended outcome

The page should feel as though it is listening with the reader. A visual appears because the teacher has
just done something visible to the text: grouped words, translated a term, followed an echo, compared two
passages, traced a chain, corrected an over-reading, supplied context, or said a sentence worth holding.
The stage should change more often across time, while only the current thought remains visually dominant.

The target is not “more cards.” It is:

> Scripture persists; one visual thought arrives, holds briefly, and makes room for the next thing the
> teacher actually says.

## Complete visual inventory

### Tour framing

| Type | What chooses it | What it does | Audit read |
| --- | --- | --- | --- |
| `standard` | Luna form role | Default editorial tour | Real checked-in replay. |
| `quiet` | Luna form role | Larger, slower, lower-information tour | Supported; no real saved evidence. |
| `lexicon` | Luna form role | Term plus rendering chips | Supported; house-QA atlas covers layout. |
| `path` | Luna form role | Waypoints along a vertical route | Real Luna role evidence exists in the current untracked Pentecost run. |
| voices | House arithmetic | Shows proportional time by source | Requires multiple sources; current broad run exercises it but no named replay does. |
| whisper | Luna whisper role | One listening cue per reading | Appears briefly, then retires after eight seconds. |
| form-stage fallback | Luna form role plus house validation | Draws a late verse/group when the director returns no scenes | Weaker than director timing; no durable browser fixture yet. |

### Playback stage

| Type | Use it when the podcast… | House rendering | D17 active lifecycle | Historical D14 Luna evidence |
| --- | --- | --- | --- | ---: |
| scene / verse | moves into a passage or substantial context movement | Canonical verse field, or a centered bare stage | Holds until the next scene | 21 scenes |
| derived word light | says a group word before its bracket completes | Thin inline underline | Until group completion | Present |
| group | works a pattern inside the displayed verse | Measured SVG loom/bracket | Until the next ordinary thought, scene, or 9s cap | 30 |
| footnote | makes a translation or textual claim about one word | Exact-word note attachment | Until the next ordinary thought, scene, or 9s cap | 0 |
| term | explains a Hebrew or Greek word | Typographic term/gloss lockup | Until the next ordinary thought, scene, or 9s cap | 1 |
| allusion | says one passage echoes or carries another | Citation rail plus canonical reading copy | Until the next ordinary thought, scene, or 13s cap | 4 |
| compare | sets two passages side by side | Balanced excerpts with a quiet semantic axis | Until the next ordinary thought, scene, or 15s cap | 1 |
| chain | traces one line through 2–4 passages | Whole horizontal route; vertical on mobile | Until the next ordinary thought, scene, or 18s cap | 0 |
| caveat | says what the text does not claim | Capped corrective boundary | Until the next ordinary thought, scene, or 12s cap | 0 |
| aside | moves through context, story, setup, or application | Quiet sentence treatment | Until the next ordinary thought, scene, or 10s cap | 3 |
| highlight | says one verbatim sentence worth holding | Exclusive substitutive spotlight | Until the scene or 11s cap | 5 |

The counts are a historical D14 baseline from six Luna director records: the checked-in Revelation replay
plus five Pentecost-related captures. They cover 22.82 minutes, 21 scenes, and 44 accepted artifacts.
Groups are 30/44 (68%); footnote, chain, and caveat never appear. They describe the pre-D17 prompt and
policy, not current D17 selection quality.

## Historical D14 finding: what suppressed frequency

1. The initial prompt said one scene was common, “fewer, truer artifacts beat coverage,” called highlights
   mostly unnecessary, and populated only a group in its JSON example. Group was the easiest safe default.
2. Luna received front-truncated prose without a clock, then was asked to distribute cues across clips as
   long as 15 minutes. Repeated phrases always resolved to their first occurrence.
3. A mixed clip could not represent a context scene alongside passage scenes. One current clip showed
   nothing until second 89; a fill aside at second 73 was then discarded as owned by no scene.
4. Fill targeted only the largest gap above a hard-coded 45 seconds. Three filled runs still ended with
   maximum visual gaps of 55, 121, and 89 seconds.
5. Five grounded candidate artifacts were later dropped because their cue landed outside the half-open
   window of the model-assigned scene.

## Historical D14 finding: what created busyness

Every artifact had an entrance time but, except for highlight, no exit. A valid verse scene could retain
15 artifacts plus derived word lights. Group/allusion history merely dimmed; term, footnote, compare,
chain, and caveat stayed fully present. Seeking near a scene's end reconstructed all history, producing
the maximum possible stack. Fixed DOM bands also meant a late micro note could appear above an earlier
support card rather than where the listener's attention currently was.

## D14 interim contracts (superseded)

This section records the D14 close. D15 replaced its multi-channel presentation with one transient thought;
D17 replaced its fixed generation and fill policy. It is retained to explain the audit trail, not current
runtime behavior.

### Generation cadence

- The director received timecoded transcript coverage sampled across the whole clip, while semantic
  validation and cue location still use the full transcript window.
- Luna returned an approximate `at` hint with each copied cue. The number only disambiguates repeated
  occurrences; the verbatim cue remains the evidence.
- The prompt named the teacher action that earns each artifact and asked for conditional 25–35 second
  cadence. It explicitly rejects generic groups when a more specific type fits.
- `verse: null` context scenes could coexist with passage scenes. The house could add one bare prelude when
  the first passage begins at or after second 18.
- Portable cue-truth followed its timestamp into the correct scene. Group and footnote remained verse-bound.
- Fill used the shared 36-second limit and could remeasure a later gap. D17 replaces this with one batched
  request covering every qualified gap.

### Simultaneous density

| Channel | Wide stage | Narrow stage |
| --- | --- | --- |
| anchor | Scripture plus one current group | Scripture plus one current group |
| micro | One term or footnote | Shares the support slot |
| support | One allusion, compare, chain, caveat, or aside | One micro/support artifact total |
| focus | Highlight substitutes for all other artifact channels | Same |

The browser derives `exitAt = min(scene end, next event claiming the channel, at + maximum dwell)`.
Playback, seeking, and responsive reconstruction all use that same predicate. Newly active cards move the
theater's scroll camera above the fixed caption/control reserve. Narrow group labels are horizontal below
the verse rather than rotated in a 58px gutter.

### Measurability

Final normalization records per-type counts and cadence: entrance count, unique beat count, first/last
beat, and largest visual gap. The cost-free `visual-artifact-atlas` replay covers all nine renderers and is
explicitly labelled `house-qa` with zero passes, tokens, or provider cost.

## D14 close: what remained unproven

- At D14 close, the revised prompt had not purchased a new Luna run. D17 later made the exact two
  same-clip calibration checks recorded below; neither is broad organic-distribution evidence.
- There is still no real Luna footnote, chain, or caveat example. The atlas proves renderer behavior, not
  semantic selection quality.
- The existing five-step path run is paid real evidence but is not yet a checked-in named replay.
- Quiet form, a Luna-authored bare scene, and the form-stage fallback still lack durable browser evidence.
- Closed by D17: fill now batches all qualified gaps into one Luna request and accepts at most one beat per
  gap.
- Closed by D17: cache identity now includes both the director-policy version and full transcript-window
  hash on the server.

## D15 premium-stage follow-up — 2026-08-02

D15 supersedes the runtime presentation described above; the earlier tables remain the audit trail for
the system it replaced.

- Scripture remains visually stable while exactly one transient thought occupies one aligned host beneath
  it at every viewport. There are no separate anchor, micro, and support stacks.
- A spoken word cue leads into the completed thought. A substantive thought retires the whisper, the next
  thought replaces the current one, and focus is exclusive for its complete dwell. Anchored compositions
  leave atomically instead of fading after their Scripture marks disappear.
- Loom geometry is measured from rendered word and line rectangles. Every requested contact must resolve;
  per-line wefts join one legal padding-lane warp, and an interline route is used only when the measured
  gap can safely hold it. Punctuation-normalized matching preserves source offsets and occurrence choice.
- The loom title is HTML, not SVG text: it shares the Scripture alignment, sits close to the weave, and
  uses the actual minimal displayed span when the director supplied no useful semantic label. No permanent
  desktop label gutter is reserved.
- Term, footnote, allusion, compare, chain, caveat, aside, and highlight now have semantic compositions
  instead of interchangeable bordered cards. Chain enters whole, including direction and endpoint;
  compare names its axis and both endpoints; term and footnote refuse a detached approximation.
- A centralized rail reserve and measured camera keep all compositions above the caption and controls.
  The tallest audited desktop and mobile chains remain above that boundary with zero horizontal overflow.

The cost-free browser evidence is indexed in `output/visual-audit-d15-2026-08-02/AUDIT.md`. It includes
all nine atlas renderers at 1280×720, the five layout-critical renderers at 390×844, and two real-replay
loom edge cases. All sampled atlas beats exposed exactly one `[data-visual-kind]`; console inspection was
clean. D15 made zero provider calls and did not alter search, retrieval, prompts, or routing.

## D16 editorial-precision follow-up — 2026-08-02

### Honest pre-polish ranking

| Visual | D15 design read | D16 disposition |
| --- | --- | --- |
| Loom | Pass; connected and titled without a gutter | Retained as a reference composition |
| Footnote | Pass; exact word and conventional note attachment | Retained |
| Term | Pass; clear typographic lockup | Retained |
| Highlight | Pass; strongest focus composition | Retained |
| Allusion | Near pass; still resembled a paragraph beside a rule | Citation and reading copy now form a deliberate editorial split |
| Compare | Below bar; “Verse above” left one half empty | Two real excerpts, balanced endpoints, and a quiet semantic axis |
| Chain | Below bar; tiny line-clamped passage ladder | Complete claim excerpts, horizontal desktop route, vertical mobile route |
| Caveat | Near pass; generic alert-like vertical line | Capped reading boundary and stronger sentence measure |
| Aside | Near pass; lowercase fragment beside an arbitrary dash | Sentence treatment, controlled measure, and quieter mark |

### Final browser read

All nine current atlas renderers now pass the D16 premium bar in their intended role. “Pass” does not
mean equal visual weight: aside remains deliberately recessive, caveat remains a reading boundary, and
highlight remains the only full focus state. Variety comes from semantic composition, not from more
decoration or more simultaneous objects.

The final matrix captures every type at 1280×720 and 390×844. Each sampled beat exposed one current
composition and zero horizontal overflow. Desktop chain ended at 536.6px above a 619.9px rail. Mobile
compare ended at 710.3px above a 728.9px rail; mobile chain used 43.5px of automatic theater scroll and
ended at 697px. Normal-motion highlight replacement cleared focus and outgoing state. Dark and light
checks logged no browser errors.

### What is still not proven

- The atlas has a three-link chain. The renderer accepts two to four links, but the four-link mobile
  extreme is not separately captured in this audit.
- The house fixture proves renderer quality, not whether Luna will choose the right artifact often enough
  in organic listening. No paid run was manufactured for D16.
- Unexpectedly long references or non-English director copy remain future stress cases. Current fixture,
  punctuation, wrapped-loom, desktop, and narrow evidence pass.

Full evidence and filenames: `output/visual-audit-d16-2026-08-02/AUDIT.md`.

## D17 Luna-director policy follow-up — 2026-08-03

D17 supersedes D14's fixed, scene-nested direction policy while preserving the D15/D16 premium stage.
The durable schema-v2 shape separates structural passage/context scenes from a flat chronological `beats`
list; the current policy is `magic-director-3`. `magic-director-2` remains byte-preserved historical
calibration evidence and is explicitly superseded rather than upgraded. Luna must classify the teacher's
action first and receives compact positive examples for group, footnote, term, allusion, compare, chain,
caveat, aside, and highlight. `group` is only the fallback for a genuine within-verse wording pattern,
and compare axis must be exactly `likeness` or `difference`.

### Grounding, capacity, and fill

- Copied transcript cues remain the timing evidence. The house resolves World English Bible text and
  verifies displayed-word occurrences. Compare and chain accept same-chapter ranges of one to three
  verses; invalid, oversized, contradictory, or non-canonical snapshots are refused.
- Scene and beat capacity derives from duration and sustained teaching. The per-type limits and the hard
  maxima of 12 model scenes and 48 beats are safety ceilings, not visual-density targets. A separate
  verse-less house prelude may occupy second 0 without consuming or displacing model capacity; if an early
  cue scene makes that slot illegal, the prelude is omitted rather than shifted.
- Structural-scene, ordinary-thought, and all-visual cadence are measured independently. Highlight remains
  excluded from ordinary-thought cadence but counts as a real visual entrance for gap fill. Its ceiling is
  earned at one per 180 seconds of sustained teaching, rounded up and still bounded by clip safety caps.
  All transcript-rich visual gaps longer than 36 seconds share one fill request, and each selected gap can
  add zero or one grounded beat. The fill prompt receives already accepted `kind@time` entries and the
  exact remaining highlight capacity.
- A fully valid fill-only portable beat before the first verified scene may commit one reserved
  `house:prelude` after semantic validation. Two valid early portable beats reuse it, an invalid proposal
  leaves no scene mutation, and group/footnote remain passage-coordinate types that are refused there.

### Projection and accountability

- Every non-highlight artifact uses the same ordinary-thought slot, so the next thought replaces the
  current one at desktop and mobile widths. Highlight is exclusive and a thought that entered beneath it
  never resurrects. Asides replace like other thoughts; only aside-to-aside entrances observe the 8-second
  cooldown.
- The server ledger distinguishes proposed, precisely rejected, accepted, focus-masked, superseded, and
  actually projectable beats. With `?qa=1`, bounded browser memory adds actual mount, reveal, and renderer-
  refusal observations without writing user substrate or durable QA state.
- The browser's seven-part fingerprint binds schema, policy, Luna role, record, clip bounds, and effective
  reason. The authoritative server key adds the full transcript-window hash. Live and replay directions
  must match the current step fingerprint before entering the browser cache.

### Evidence and verification state

New v2 evidence and replay writes are accepted only after exact outer-envelope/inner-result reconciliation,
projection reconciliation, redaction, and canonical WEB revalidation. Supported v1 files upgrade only at
read time and remain byte-for-byte append-only; lossy, contradictory, non-canonical, corrupt, or newer
unsupported records are refused.

The combined focused offline suites pass 34/34: current policy, both checked-in replays, all nine atlas
kinds, response-to-step identity, canonical/evidence boundaries, duration-scaled highlight caps, the
transactional early-prelude contract, and migration of every checked-in v1 director record. Cost-free D17
browser replay QA under `output/playwright/d17-magic-luna-policy/` produced 18 atlas frames: all nine kinds
at 1280×720 and 390×844. QA memory observed nine mounts and nine reveals at each viewport, no renderer
refusals, exactly one current composition, highlight-only focus mode, zero page/theater horizontal
overflow, and every composition above the listening rail. Reload and normal-motion seek/resize checks
logged zero model-route traffic, no console error, and no page error; the real Revelation replay's
projected-visible and superseded records reconciled with actual reveals.

### Same-clip policy calibration

D17 changed neither search nor retrieval. It made exactly two paid `gpt-5.6-luna-medium` OpenRouter checks
at medium reasoning against the same 84-second Revelation clip:

| policy | wall time | provider cost | passes | proposed | retained |
| --- | ---: | ---: | ---: | --- | --- |
| historical `magic-director-2` | 24.343s | `$0.001779175` | 2 | initial: 9 highlights + 1 compare; fill: 1 highlight | 7 highlights |
| current `magic-director-3` | 30.541s | `$0.00196095` | 2 | initial: 1 compare + 2 terms; fill: 1 aside | 2 terms, 0 highlights |

Total spend was `$0.003740125`. Policy v2 proved the failure: a short clip became seven focus takeovers,
and its fill treated the clip as falsely quiet enough to ask for another highlight. Policy v3 corrected
that selection on the same clip: it retained zero highlights and chose two specific term visuals.

The policy-v3 check also exposed two honest misses. Compare was rejected because its axis was invalid, and
the fill aside was rejected because its verified cue fell before the first verified scene. The prompt now
requires an axis of exactly `likeness` or `difference`, and the transactional early-prelude behavior above
is offline-covered. No third paid call was made, so neither last refinement is claimed as live-rechecked.

Evidence inventory after the second call:

- `2026-08-03T16-19-22-217Z-b59590c50ab533f8.json` — policy v2, byte-preserved,
  `superseded-policy`.
- `2026-08-03T16-34-08-040Z-fb7fd99cb163fd01.json` — policy v3, current and ready.
- 21 director files total: 20 ready (19 v1 read-time migrations plus the policy-v3 file) and one
  superseded policy-v2 file. All 8/8 role-evidence files are ready.

Every `/magic` role remains `gpt-5.6-luna-medium` through OpenRouter at medium reasoning; Sol and
direct-vendor substitutions remain refused. The same-clip comparison proves the old highlight failure and
the policy-v3 correction for this clip, not broad organic use of all nine types. Real Luna footnote,
chain, and caveat breadth remains unproven; the atlas proves those renderers, not Luna's distribution.
