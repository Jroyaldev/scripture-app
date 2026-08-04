# Tour Lab

An experiment, deliberately outside the app: **replace treatment length with understanding** as the
thing that chooses clips.

The app today can build a chapter walk by picking the *longest* treatments of a passage. This lab hands
a tool-using model the same corpus and asks it to read around until it can justify each clip. A question,
a grief, a text, a topic, a word or a whole book goes in; an ordered tour of real audio comes back, with
the model's reason for every step and the actual cost of the run.

```
npm run lab:tour          # http://localhost:5599
npm run lab:tour:run -- --model deepseek-v4-flash --fixture text-genesis-6
npm run lab:tour:run -- --model deepseek-v4-flash --all
npm run lab:tour:run -- --rebuild-ledger   # runs/ is the source of truth
```

First boot builds a search index over the corpus (~9s, cached in `lab/tour-lab/.cache/`, gitignored).
Delete that directory to rebuild.

## The corpus

Read-only, never written: `~/ScriptureLibrary/.artifacts/`

| artifact | what it gives the model |
| --- | --- |
| `transcripts/*.json` | 3,521 episodes, ~1,200 hours, word- and segment-level timestamps |
| `references/<recordId>.json` | 41,435 timestamped scripture moments with relation kind and evidence quote |
| `passage-index.json` | chapter → every moment that treats it, with `audioUrl` and offset |

Filenames mangle `:` in a recordId to `__`. Override the location with `TOUR_LAB_ARTIFACTS`.

Retrieval is two-stage so 27.6M tokens are read once, not per query: BM25 over whole episodes from the
cached inverted index, then 50-second windows re-scored inside the top episodes to produce a timestamp.
A cold query is ~100ms, a warm one ~20ms.

## The tools the model gets

| tool | returns |
| --- | --- |
| `list_sources()` | the eight shows, episode counts, hours, which ones drift |
| `search_corpus(query, sourceId?, limit?)` | ranked hits: `recordId`, best-matching timestamp, surrounding transcript |
| `moments_for_passage(book, chapter, verse?)` | every timestamped treatment of a text, with relation + dwell time |
| `episode_skim(recordId, fromSec?, toSec?)` | a map of up to 25 min of one episode — one line per ~45s, a tenth of the tokens of the tape it covers |
| `transcript_window(recordId, fromSec, toSec)` | the tape between two timestamps, up to 300s per call, with `seams` marking the speaker's own pauses (clip-boundary candidates) |
| `episode_info(recordId)` | title, show, duration, coarse outline, every scripture moment detected |
| `read_passage(book, chapter, fromVerse?, toVerse?)` | the scripture text itself (WEB, public domain) — so a "why" quotes the text, not the model's memory of it |
| `submit_tour(...)` | the only exit |

`transcript_window` is the tool that makes this experiment different from a search ranking: the model has
to read before it can commit a clip boundary.

The reading economy was retuned on 2026-07-31 after two benches and a literature pass. The old 180s
per-call cap made models page through episodes in chains (2.7 consecutive windows on average, each a full
thinking episode); 300s is the ~1,000-token read unit the agentic-retrieval work converged on (A-RAG,
arXiv:2602.03442; GRASP, arXiv:2607.10463 — precise hierarchical reads beat bulk loading on *quality*,
and overly coarse reads blur the agent's next move). The anti-slurp line the per-call cap was defending
moved to where it belongs: a **45-minute per-run tape budget** (`totals.tapeSec` in every run record) —
generous enough that no honest run has approached it, hard enough that bulk cannot substitute for
judgement. Skims are free: charging for the map would push models back to reading tape. `search_corpus`
answers also carry a `tip` when the query names a passage the moments index covers, because the first two
benches showed models text-searching "Genesis 6 sons of God" six times for every `moments_for_passage`
call; a hint on a response already paid for steers without adding a tool (each added tool taxes every
decision — arXiv:2605.00136).

## The contract

```json
{ "title": "...", "intro": "...",
  "steps": [{ "recordId": "...", "startSec": 0, "endSec": 0, "why": "..." }],
  "closing": "..." }
```

Validated on the server, never repaired: 3–8 steps, each clip ≥20s and ≤15min, `endSec` inside the
episode, `recordId` present in the corpus, `why` at least 40 characters. An invalid tour comes back to the
model as a list of errors with an instruction to fix exactly those and resubmit; the count of rejected
drafts is kept in the run record so a model that needs three tries is visibly worse than one that needs none.

## Models and auth

Two models, four rows — the luna variants are the same slug with a pinned effort, there to make thinking
budget the only variable in a comparison. All are OpenAI-compatible chat/completions with tool calling,
so one client class covers the lot.

(The roster peaked at seven on 2026-07-31 and was cut twice the same day, both times on the maintainer's
call: `poolside/laguna-s-2.1:free` and `google/gemini-3.5-flash-lite` each burned a probe's full 16 model
calls without ever submitting a valid tour; then `x-ai/grok-4.5` and `openai/gpt-5.6-luna-pro` went on
cost — grok's one probe made the afternoon's best single tour at $0.188, which is ~40× luna's per-tour
spend on the defaults arm — with `inclusionai/ling-3.0-flash:free` leaving alongside to focus the grid on
deepseek-versus-luna. Every departed model's run records stay in `runs/` as the evidence, and their
`pricing.json` rows stay so those records still render.)
Credentials are read from the repo `.env` (untracked; the loader also checks sibling git worktrees, or set
`TOUR_LAB_ENV_FILE`). Keys never reach the browser, the logs, or a run record.

| row | model | key | model override | effort override | pinned effort |
| --- | --- | --- | --- | --- | --- |
| deepseek-v4-flash | `deepseek/deepseek-v4-flash-0731` | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` | `DEEPSEEK_REASONING` | — |
| gpt-5.6-luna | `openai/gpt-5.6-luna` | `OPENAI_API_KEY` | `LUNA_MODEL` | `LUNA_REASONING` | — |
| gpt-5.6-luna-high | `openai/gpt-5.6-luna` | `OPENAI_API_KEY` | `LUNA_HIGH_MODEL` | `LUNA_HIGH_REASONING` | `high` |
| gpt-5.6-luna-medium | `openai/gpt-5.6-luna` | `OPENAI_API_KEY` | `LUNA_MEDIUM_MODEL` | `LUNA_MEDIUM_REASONING` | `medium` |

Every row but DeepSeek rides one OpenRouter credential, and **the sharing stops at the key**. Every row owns
a distinct model-override slot, so no single variable can quietly repoint the whole roster at one slug —
`OPENAI_MODEL` is read by nothing, and each override names the row it belongs to.

The requested slug is what we ask for; what the endpoint accepts is resolved at runtime. The base URL's
host decides the form to try first — a vendor's own endpoint wants the bare name, an aggregator wants
`vendor/model` — and the choice is then confirmed against `GET /models` rather than guessed. If the exact
requested build is not published, the lab falls back to the same family without the date suffix and says
so loudly: in the run record, in the panel header, and in a banner above the tour. A model with no key
is disabled in the UI with the env var it needs, and a keyless run returns one sentence, not a stack trace.

As configured today every base URL is `https://openrouter.ai/api/v1`, which publishes both slugs
verbatim, so every row resolves exact via the models list and reports its own accounted cost. (The fallback path is not dead code: pointed at `https://api.deepseek.com`,
which publishes only `deepseek-v4-flash` and `deepseek-v4-pro`, the DeepSeek row lands on the undated
build through the family-prefix fallback and every record says so.)

### Reasoning effort

`<MODEL>_REASONING`, then the model's own pinned default, then shared `TOUR_REASONING` — first one set
wins, and `low|medium|high|xhigh|max` are all passed through to the aggregator's unified `reasoning`
field. The two luna variants pin their efforts (`high` and `medium` — pinning is what they are for);
deepseek and plain luna inherit `TOUR_REASONING`, currently `max`. Unset everywhere leaves the vendor's
own default. A direct vendor endpoint has no
unified field to carry an effort, so the header strikes it through rather than implying it was sent.

**Every run record says which effort ran and where it came from**, in `model.reasoning`, alongside the
resolved slug — and so does the ledger, which counts runs per effort rather than pretending one number
covers a model's whole row.

## Cost

Every model call records prompt/completion/reasoning/cached tokens, latency and tool-call count; the run
record in `runs/<timestamp>-<model>.json` carries per-call detail and per-run totals next to the tour.
`runs/ledger.json` sums spend per model across all runs.

Cost comes from `pricing.json` (per-million input/output rates, **marked EDIT ME — every model here
postdates anything the code's author knew, so every rate is a placeholder**), *except* where the endpoint
reports its own accounted cost, which always wins. Each run says which basis was used: `provider`,
`price-table`, or `unpriced`. Price-table figures are tinted in the UI to keep the distinction visible.

The two `:free` rows carry zeros because their slugs carry OpenRouter's `:free` suffix, and that is all
those zeros assert — nobody verified a tier. Both models resolve through an endpoint that accounts its own
spend, so the `provider` figure in the run record is the only one to trust; a free tier that starts
charging, or a run that lands on the paid twin, shows up there and not in the table.

## Bench set

`fixtures.json` — eight prompts spanning the modes a real user arrives in: two doctrinal (one contested),
two pastoral (grief, doubt), one named text, one topic, one narrow word study, one whole-book orientation.
Running every model over the same eight makes the run records into a fair table.

## The page

A responsive grid of model panels — one column on a phone, two from 900px, three from 1500px, and never
more, because a panel carrying a player and eight steps stops being readable much narrower than that.
Each panel owns its label, its requested-and-resolved slug, its effort chip, an exact-or-fallback banner,
its own **Run** button, its tour with the seeking player, and its cost/latency/tool-call strip.

**Send to All** puts the current prompt through every configured model at once. `POST /api/tour` takes
`models: [...]` as readily as `model:`, fires them all with `Promise.allSettled`, and multiplexes their
progress down one SSE connection with every frame tagged by model key, so each panel fills in as its own
model lands and a model that thinks for three minutes delays nothing but itself. One stream rather than
seven EventSources, because seven would sit on the browser's ~6-connection-per-origin limit and the
seventh panel would wait on a socket. A missing key, a rejected slug or a provider 500 resolves inside
its own panel; the other six keep going, and every one of them still writes its run record.

## `/magic`: Luna directs, the house renders

`/magic` is an isolated presentation system over the Tour Lab corpus. It does not use the general model
grid: its search, whisper, form, and visual-direction roles all resolve through the single
`gpt-5.6-luna-medium` contract — `openai/gpt-5.6-luna` on OpenRouter with medium reasoning. The server
checks both the requested runtime and the model/provider reported by the response. A missing identity,
different Luna build, direct-vendor endpoint, unapplied effort, or Sol override fails closed before the
result can direct the page.

The callable stages are deliberately separate:

| stage | route | Luna chooses | house code owns |
| --- | --- | --- | --- |
| listening search | `POST /api/tour` with `surface: "magic"` | sources, clips, order, and reasons | corpus tools, clip validation, aborts, run ledger |
| whispers | `POST /api/whispers` | one short listening cue per step | count/length validation and quiet failure |
| form | `POST /api/form` | `standard`, `quiet`, `lexicon`, or `path`, plus optional stage hints | typed plan validation and DOM layout |
| director | `POST /api/direct` | structural passage/context scenes plus a flat chronological list of semantic beats | transcript/cue verification, canonical WEB resolution, timing, budgets, caps, projection, coordinates, animation, and final rendering |

Read-only support routes are `/api/window`, `/api/passage`, `/api/replay/:id`, `/api/direct-runs`, and
`/api/magic-role-runs`. The model never emits CSS, SVG coordinates, or animation instructions.

The v2 movement budget in `magic-contract.mjs` is derived from clip duration and sustained teaching rather
than a fixed four-scene target. The hard ceilings remain 12 model scenes and 48 beats, with per-type caps;
they are refusal limits, not instructions to fill the page. One separately reserved house prelude may
appear at second 0 when a passage begins at or after second 18 or when a fully valid portable fill beat
lands before the first verified scene. It is verse-less, cannot move, cannot evict a valid Luna scene,
and is committed only after the fill beat passes semantic validation. House scene entrances retain a
12-second floor and house thought entrances a 2.5-second floor. Asides use ordinary thought replacement
plus an 8-second aside-to-aside cooldown, not a global silence zone.

Every time belongs to one half-open scene window and carries a source: `cue` and verified `word` times are
transcript truth and never move; only `house` times may shift to find a legal slot. Passage snapshots are
re-resolved from the World English Bible. Compare and chain accept browser-safe same-chapter ranges of one
to three verses; invalid, oversized, or non-canonical ranges are refused. After the initial pass and any
translation-anchor repair, every transcript-qualified projected visual gap longer than 36 seconds is sent
through one batched fill call, with zero or one accepted beat per gap.

On the client, director prefetch has 2 workers. Its seven-part request fingerprint binds schema, policy,
the Luna role, record, tenth-second bounds, and the effective reason hash. The server inserts the full
transcript-window hash to form the authoritative eight-part cache key. Identical keys share one in-flight
job and a bounded 24-result completed cache; replay seeding and live responses must also match the current
tour step's browser fingerprint before they enter that cache.

Every paid pass records exact runtime identity, latency, finish reason, prompt/completion/reasoning/cached
tokens, provider cost, and validation outcome. The v2 outcome ledger keeps every proposed beat, precise
rejection, accepted beat, focus-masked beat, superseded beat, and beat that can actually project. With
`?qa=1`, the browser also exposes bounded in-memory mount, reveal, and renderer-refusal observations; that
QA memory is not durable user data. Completed director evidence is append-only under `director-runs/`;
whisper/form evidence uses `role-runs/`. Reads and writes re-redact secrets, reconcile the outer request
envelope with the inner result, and revalidate canonical WEB snapshots.

The named local acceptance fixture is:

```
http://localhost:5599/magic?replay=revelation-1-pastoral-center
```

Replay mode validates and seeds the tour, whispers, form, and directions locally; it cannot call
`/api/tour`, `/api/whispers`, `/api/form`, or `/api/direct`. The fixture contains one real Luna-medium
direction for Revelation 1:17–18: 3 scenes, 6 artifacts, one 17.649-second pass, 1,395 prompt / 2,454
completion / 2,070 reasoning tokens, and `$0.0016467` provider cost. All later layout, motion, seeking,
resize, and accessibility checks are cost-free.

Focused offline verification:

```
node --import tsx --test tests/tour-lab-magic-contract.test.ts tests/tour-lab-scripture-director.test.ts
```

The next useful improvements are real-evidence breadth rather than a broader runtime: promote the already
paid Pentecost path run into a named replay, capture Luna-grounded footnote/chain/caveat examples when they
naturally occur, promote the cost-free D17 browser scripts into a maintained QA command, and measure
publisher ad-insertion drift. A port into the main Scripture renderer remains a separate human decision.

### Visual cadence without visual accumulation

The visual vocabulary is a scene/verse base plus nine director artifacts: group, footnote, term, allusion,
aside, compare, chain, caveat, and highlight. A derived word-light can lead into a group. The tour itself
also has four page forms (`standard`, `quiet`, `lexicon`, and `path`), voices, waypoints, whispers, and the
weaker form-stage fallback. Those framing forms are distinct from the visual direction that follows a
podcast while it plays.

The historical D14 six-run sample showed that merely having nine artifact types did not make the page
varied: 30 of 44 accepted artifacts were groups, while footnote, chain, and caveat never appeared. Those
counts describe the pre-D17 director, not the current policy. More importantly, every non-highlight
artifact used to persist until the next scene. A valid verse scene could therefore accumulate 15
artifacts, and seeking late in it reconstructed the busiest possible state.

The house now treats frequency and simultaneous density as separate contracts:

- Luna sees timecoded transcript coverage, classifies the teacher's action first, and chooses the most
  specific supported type. The prompt includes compact positive examples for all nine types. `group` is
  only the fallback for a genuine within-verse wording pattern, not a generic safe answer.
- A mixed clip may contain `verse: null` context scenes. If the first passage begins 18 seconds or more
  into the clip, the house supplies a verse-less prelude rather than leaving a blank theater. A valid
  fill-only portable thought before the first scene can commit the same reserved prelude transactionally;
  invalid proposals leave no scene behind, and group/footnote coordinates remain bound to displayed
  Scripture.
- Structural scene cadence and transient ordinary-thought cadence are measured independently. The browser
  derives `exitAt` rather than storing model-authored durations and projects exactly one ordinary thought
  at any width. A highlight is exclusive for its dwell; a thought that entered underneath it does not
  resurrect. Dwell remains house-owned and the next ordinary thought retires the previous one sooner.
- Playback, seek, and resize use the same active-time predicate. Mobile group labels sit horizontally
  below the verse, and the theater scrolls the newly active card above the fixed caption/control reserve.

Every artifact renderer can be checked without a provider call at:

```
http://localhost:5599/magic?replay=visual-artifact-atlas
```

That fixture is explicitly `provenance: "house-qa"`, reports zero passes/tokens/cost, and must never be
presented as Luna evidence. The original Revelation replay remains the model-traceable fixture.

## Premium one-thought stage (D15)

D15 supersedes the earlier multi-channel playback presentation above without changing its historical
audit record or making another provider call. Scripture is now the stable stage and exactly one transient
thought occupies a shared region beneath it. A word cue is the lead-in to that thought, the next thought
replaces it, and highlight remains exclusive. Playback, seeking, and resize all project the same
media-time state, so old cards cannot resurrect or fade while detached from their Scripture anchor.

The loom is now one measured relationship rather than an underline plus a label gutter: every requested
word must resolve, contacts join through per-line wefts to one legal left- or right-padding warp, and the
sentence-case title is drawn in the shared thought region from the actual displayed phrase. Term and
footnote lock to exact words; allusion uses an echo rail; compare names its axis and endpoints; chain
shows every node, direction, and endpoint at entry; caveat, aside, and highlight each keep their own
semantic grammar. The stage shares one spacing, typography, color, motion, and fixed-control reserve
across desktop and mobile.

The complete cost-free evidence set is in `output/visual-audit-d15-2026-08-02/`: all nine renderers at
1280×720, five layout-critical renderers at 390×844, plus punctuation and wrapped multi-line loom cases
from a real replay. Browser inspection found one composition per beat, no horizontal overflow, all
content above the listening rail, and no console errors.

## Editorial precision follow-up (D16)

D16 audited the D15 frames as design, not merely as legal layout. Compare and chain were still below the
bar: compare became visually empty whenever one endpoint referred to the verse above, while chain
compressed full passages into a small truncated ladder. Allusion, caveat, and aside were coherent but
still read as lightly styled notes. Loom, footnote, term, and highlight were the stronger reference set.

Compare now keeps two balanced, claim-bearing excerpts and uses a quiet center axis. Chain chooses the
complete quoted clause that carries each link, runs horizontally on desktop and vertically on mobile,
and never line-clamps the claim. Allusion separates its marginal citation from its reading copy; caveat
uses a capped boundary with semantic purpose; aside receives sentence treatment rather than displaying
an unfinished fragment. The immersive theater still scrolls when needed, but its browser scrollbar is
not visual furniture.

The final evidence is in `output/visual-audit-d16-2026-08-02/`: every renderer at 1280×720 and 390×844,
plus light-mode compare and chain spot checks. Every sampled beat had one current thought, no horizontal
overflow, content above the listening rail, and a clean console. The atlas is still house QA, not Luna
evidence, and D16 made no provider request.

## Luna director policy v3 (D17)

D17 supersedes D14's fixed scene-shaped director while retaining the premium D15/D16 stage. Luna now
returns structural scenes and independent flat beats. Its prompt is action-first, includes positive
examples for all nine artifacts, makes `group` the conditional fallback for a real within-verse pattern,
and requires a compare axis of exactly `likeness` or `difference`. The house verifies copied cues,
resolves canonical WEB passages and bounded ranges, derives the duration/sustained-teaching movement
budget, and owns the prelude reserve, safety ceilings, timing, dwell, and final one-thought projection.

Policy v3 separates ordinary-thought cadence from all-visual cadence. Highlights remain outside the
ordinary-thought count, but they count as real visual entrances when fill looks for quiet gaps. Highlight
capacity is earned from sustained teaching time rather than taken from one arbitrary global cap: the
current ceiling is one per 180 active seconds, rounded up, still bounded by the clip-wide safety ceiling.
All transcript-qualified gaps longer than 36 seconds share one fill request, each gap may contribute at
most one grounded beat, and the fill prompt receives the already accepted `kind@time` list plus remaining
highlight capacity. Ordinary thoughts replace one another; highlight remains exclusive; only an aside
following another aside invokes the 8-second cooldown.

The durable boundary is schema v2 plus `magic-director-3`. `magic-director-2` is preserved historical
calibration evidence, not a current policy and not an automatic upgrade source. The browser fingerprint
and transcript-bound server key are distinct by design. New evidence/replay writes must pass exact
envelope, identity, projection, and canonical-snapshot checks. Supported v1 director evidence and replays
upgrade only in memory; their original append-only files are not rewritten. Malformed v1 records,
contradictory or non-canonical envelopes, and newer unsupported versions are refused.

### Same-clip Luna calibration

D17 made exactly two paid `gpt-5.6-luna-medium` checks through OpenRouter at medium reasoning against the
same 84-second Revelation clip:

| policy | wall / cost / passes | proposals | retained | finding |
| --- | --- | --- | --- | --- |
| historical `magic-director-2` | 24.343s / `$0.001779175` / 2 | initial: 9 highlights + 1 compare; fill: 1 more highlight | 7 highlights | Bad selection and a false quiet-gap fill: focus takeovers dominated one short clip. |
| current `magic-director-3` | 30.541s / `$0.00196095` / 2 | initial: 1 compare + 2 terms; fill: 1 aside | 2 terms, 0 highlights | The highlight correction held and Luna selected the more specific term type. |

Total calibration spend was `$0.003740125`. The policy-v2 record
`2026-08-03T16-19-22-217Z-b59590c50ab533f8.json` remains byte-preserved and is classified
`superseded-policy`; the policy-v3 record `2026-08-03T16-34-08-040Z-fb7fd99cb163fd01.json` is current and
ready. The present inventory is 21 director files: 20 ready (19 v1 files upgraded only at read time plus
the policy-v3 record) and one superseded policy-v2 record. All 8/8 role-evidence files are ready.

The second call was informative but not perfect: its compare was rejected because the axis was invalid,
and its fill aside was rejected because its verified cue fell before the first verified scene. Those two
findings produced the final offline refinements: the prompt now requires exactly `likeness` or
`difference`, and a fully valid early portable fill beat may transactionally commit one reserved
`house:prelude`. Two valid early portable beats reuse that prelude; an invalid proposal causes no scene
mutation; group and footnote remain passage-bound and are refused there. These refinements are covered
offline, not claimed as live-rechecked; no third paid call was made.

D17 did not change search, retrieval, or the general model roster. Every `/magic` role remains
`gpt-5.6-luna-medium` through OpenRouter with medium reasoning; Sol and direct-vendor substitutions fail
closed.

Verification is staged honestly:

- Complete: the combined focused offline contract and canonical-Scripture suites pass 34/34, including
  both checked-in replays, all nine atlas beat kinds, strict response-to-step fingerprint binding,
  duration-scaled highlight caps, the final prelude transaction contract, and read-time migration of every
  checked-in v1 director record.
- Complete: cost-free D17 browser replay QA under `output/playwright/d17-magic-luna-policy/`. The atlas
  produced all nine kinds at 1280×720 and 390×844 with one current composition, highlight-only focus, no
  renderer refusals or horizontal overflow, every composition above the listening rail, clean
  console/page logs, and zero model-route traffic. Normal-motion seek/resize checks also reconciled
  projected-visible and superseded outcomes against actual browser mounts and reveals on the atlas and
  real Revelation replay.
- Bounded conclusion: one short same-clip comparison proves the policy-v2 highlight failure and the
  policy-v3 correction on that clip. It does not prove broad, organic all-nine artifact distribution;
  real Luna footnote, chain, and caveat breadth still needs naturally occurring evidence.

## House editorial-video system (D18)

D18 adds a second deterministic layer after the Luna director. Luna still owns only grounded semantic
decisions: scenes, cues, kinds, concise claims, and Scripture references. `magic-editorial.mjs` compiles
that evidence into a complete half-open edit-decision list. The browser resolves exactly one shot for
the current media time, so play, seek, resize, normal motion, and reduced motion share one projection.

The finite component registry is:

| House component | Semantic inputs | Editorial job |
| --- | --- | --- |
| `BookendSlate` | none | Tour open, movement handoff, movement close, final close. |
| `ListeningFrame` | bare scene or intentional rest | Voice-forward arrival and clean listening breath. |
| `PassageFrame` | verse-backed scene or intentional rest | Stable 720px reading field and clean passage resolve. |
| `AnchorFrame` | group, term, footnote | Loom, lexicon, and tethered-note variants. |
| `EvidenceSpread` | allusion, compare, chain | 960px relation, split-reading, and route variants. |
| `MarginFrame` | caveat, aside | Bounded editorial qualification or quiet marginal thought. |
| `FocusFrame` | highlight | Exceptional exclusive thesis frame. |

The main callable surface is intentionally small:

- `compileEditorialPlan(direction, { durationSec, stepIndex, stepCount })` creates the complete shot list.
- `resolveEditorialShot(plan, mediaTime)` deterministically returns the one current half-open shot.
- `measureEditorialContinuity(plan, direction)` recomputes density, rest, callback opportunity, family
  succession, focus, coverage, and gates.
- `validateEditorialPlan(plan, direction)` refuses altered provenance, unsupported versions, overlap,
  early disclosure, incomplete beat representation, unused legal callback opportunity, and hard-limit
  violations.

House timing is explicit rather than model-authored: 6s opening and closing bookends; 5s scene arrivals
only when at least 3s is genuinely available; passage resolves of up to 3.5s; grounded callbacks of 3–10s with a
3s breath and at most two callbacks per beat; and explicit passage/listening rests capped at 18s. The
preferred semantic band remains 40–55% with a hard 60% ceiling. A direction below 40% passes only when
the validator independently proves that no legal grounded callback remains. Before a third contiguous
beat from one component family, the compiler carves up to 3.5s for a Scripture/listening punctuation frame from
the preceding beat while retaining every phase and source reference.

The renderer keeps one current composition plus one short outgoing transition slot. Scripture/listening
frames use the 720px reading measure; relational evidence may use 960px. Desktop compare/chain layouts
become bounded single-column routes at 620px and below. Bookends, captions, and controls reserve distinct
vertical bands; 320px short-phone evidence frames retire the caption and tighten without scrolling under
the rail. Semantic labels, glosses, notes, caveats, and asides are accepted as complete bounded thoughts or
refused—neither the server nor renderer silently slices them. Every mounted frame exposes shot, family,
component, phase, variant, source beat, scene, and transcript-segment IDs for browser QA.

### Evidence and real Luna iteration

`node lab/tour-lab/audit-director-runs.mjs` audits 40/40 saved director records without network traffic.
The original five-step Romans replay compiles to 182 shots over 23:16 with 45.4% semantic occupancy,
18s maximum rest, family run two, 4.3% focus, 100% scene coverage, and 8/8 aggregate gates.

D18 exercised the actual `/magic` UI with a request for a 25–40 minute episode on Exodus 34:6–7.
Luna/OpenRouter returned six clips across four publishers, 28:55 total. The first full-role generation
cost `$0.0453416` across 22 Luna calls and produced 39 organic beats across seven kinds; it exposed both
same-family runs and silent mid-word copy slicing. Eight later director-only calibrations used the same
six transcript windows to test the corrected complete-copy and single-word group instructions. They cost
`$0.026888575` across 17 calls, including one unsuccessful and one successful targeted group iteration.

The checked-in replay uses the latest accepted direction for each movement and contains 41 organic beats:
group 1, footnote 1, term 3, allusion 4, compare 5, chain 1, caveat 7, aside 10, and highlight 9. It compiles
to 198 shots, 39.4% aggregate semantic occupancy, eight bounded callbacks, 18s maximum rest, family run
two, 5.2% focus, and 100% scene coverage. Four movements meet the preferred band; two validate only after
the house independently proves grounded callback exhaustion. All six plans pass. Cumulative D18 spend was
`$0.072230175` across 39 Luna calls. No Sol call or search-code change was made.

The paid run is preserved provider-free at:

```
http://localhost:5599/magic?replay=exodus-34-mercy-judgment
```

`visual-artifact-atlas` still provides deterministic synthetic renderer coverage, while the refreshed real
Exodus replay now proves organic Luna selection for all nine semantic kinds. Browser captures cover every
real kind plus house bookends/rests at 1280×720, responsive 390×844 and 320×568 frames, light mode, reduced
motion, seek/resize parity, and a replay request firewall under
`output/playwright/d18-magic-editorial-video/`.

## Historical benchmark: what the first six runs said

Real runs, real money, `runs/ledger.json` total **$0.0987**. Cost basis differs by endpoint, which is the
point of recording it: DeepSeek reports no cost field so those figures are the unverified price table,
while OpenRouter accounts luna's spend itself.

| model | fixture | steps | audio | model calls | tool calls | rejected drafts | wall | cost | basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deepseek | text-genesis-6 | 6 | 18 min | 7 | 18 | 0 | 144s | $0.0177 | price-table |
| deepseek | pastoral-grief | 6 | 15 min | 8 | 26 | 0 | 180s | $0.0265 | price-table |
| deepseek | doctrinal-resurrection-body | 8 | 22 min | 8 | 21 | 1 | 207s | $0.0246 | price-table |
| deepseek | word-study-hesed | 8 | 29 min | 11 | 26 | 0 | 218s | $0.0225 | price-table |
| luna | text-genesis-6 | 4 | 12 min | 5 | 15 | 0 | 25s | $0.0043 | provider |
| luna | pastoral-grief | 5 | 18 min | 5 | 14 | 0 | 20s | $0.0032 | provider |

The shape of the difference, on this tiny sample: DeepSeek reads far more of the tape (17–20 windows per
run against luna's 8) and its tours are correspondingly denser — more voices, more quoted evidence, and it
volunteers where teachers disagree. Luna gets to a good, defensible tour in a fifth of the time for a
sixth of the cost, but with fewer steps and thinner justification. Neither had to be argued into honesty;
both quoted the transcript rather than asserting doctrine. One rejection fired for real (a `submit_tour`
call with empty arguments) and the model repaired it on the next turn.

## Caveats that belong on every tour

- Clips on ad-inserted hosts (Megaphone: `ask-nt-wright`, `spoken-gospel`) can land up to ~2 minutes off
  against today's stream. Corpus-wide drift, known, fine for a lab. Steps from those shows are flagged.
- A tour is model output over machine transcripts. The `why` text reports what a transcript says; it is not
  a claim that the speaker is right.
- The player streams from each publisher's own CDN. Most hosts serve range requests fine; Substack's
  returns 403 to a hotlink, so those steps show the failure and hand over the URL rather than sitting dead.

## Files

```
server.mjs        static + SSE proxy; keys stay here          npm run lab:tour
run-cli.mjs       same loop, headless, for the bench          npm run lab:tour:run
tour-agent.mjs    agent loop, validation retries, cost, ledger
tools.mjs         tool schemas, dispatch, the tour contract
corpus.mjs        read-only corpus + two-stage retrieval + index cache
scripture.mjs     the Bible itself (WEB verse text from data/scripture/text)
model-client.mjs  one OpenAI-compatible client, slug resolution, env loading
pricing.json      EDIT ME rate card
fixtures.json     the eight bench prompts
index.html app.js styles.css    the page
magic.html magic.js magic.css   /magic — the presentation experiment: same pipeline, different manners
magic-contract.mjs              Luna-only roles, schemas, caps, normalization, validators
magic-editorial.mjs             deterministic components, timing, callbacks, rests, continuity gates
magic-jobs.mjs                  in-flight coalescing + bounded completed director cache
director-evidence.mjs           append-only evidence and replay storage
director-runs/ role-runs/       redacted per-call evidence
replays/                        versioned, cost-free named performances
VISUAL_AUDIT.md                 visual taxonomy, evidence distribution, cadence/density contract
DIRECTOR_EVIDENCE_AUDIT.md       reproducible 32-record and long-sequence editorial audit
audit-director-runs.mjs          provider-free evidence and compiler analyzer
runs/             one JSON per run + ledger.json
```
