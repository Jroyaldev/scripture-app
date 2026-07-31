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
| `transcript_window(recordId, fromSec, toSec)` | the tape between two timestamps, **capped at 180s** so an episode cannot be slurped |
| `episode_info(recordId)` | title, show, duration, coarse outline, every scripture moment detected |
| `read_passage(book, chapter, fromVerse?, toVerse?)` | the scripture text itself (WEB, public domain) — so a "why" quotes the text, not the model's memory of it |
| `submit_tour(...)` | the only exit |

`transcript_window` is the tool that makes this experiment different from a search ranking: the model has
to read before it can commit a clip boundary.

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

## What the first six runs said

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
runs/             one JSON per run + ledger.json
```
