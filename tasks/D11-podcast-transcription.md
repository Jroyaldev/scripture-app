# TASK D11: Transcripts for the BibleProject podcast

STATUS: OPEN — pipeline written, pilot in progress. Raised 2026-07-28.

## Objective

Produce timestamped transcripts for the BibleProject podcast so the Living
Margin player can follow a transcript during playback and seek by clicking a
line. `PodcastChapter` in `src/renderer/components/PodcastPlayer.tsx` has been
the contract for this since it was written; nothing has ever filled it.

## The corpus, measured rather than assumed

Every number below was probed, not taken from the manifest.

| | |
|---|---|
| Records | 531 podcasts, **528 with audio** |
| Audio | **495.3 hours**, ffprobe-measured on all 528 |
| Reachable | **528/528**, zero failures |
| Download | 26.5 GiB, one host (Simplecast CDN) |
| Encoding | 516 × 128kbps, **12 × 96kbps** (some 32kHz mono) |
| Official transcripts | **~53%** of episodes (independent 40-episode sample; a separate 140-episode sample gave 52%) |
| Show-note chapter markers | **51 episodes (9%)**, median 12 markers each |

Three records carry no audio URL: `restless-craving-rest-2`, `significance-7`,
`why-are-there-10-plagues`.

Three manifest durations are wrong by more than 10% and should be corrected at
the source: `what-do-moses-and-rock-have-do-jesus` (states 46, is 68.1),
`israel-tests-yahweh` (states 60, is 71.3), `how-not-read-bible` (states 65, is
56.4).

Two bitrates in one catalogue caused a false alarm worth recording: byte-derived
durations assuming 128kbps made eleven 96kbps episodes look like they carried
the wrong recording, at a constant ratio of 0.75 — which is 96/128, and is the
tell that the assumption was wrong rather than the data. Do not re-derive
duration from `Content-Length`; `probe_durations.mjs` reads the container.

## Why Parakeet and not Whisper

`nvidia/parakeet-tdt-0.6b-v3`, on one property that outweighs word error rate:
it is a frame-synchronous transducer emitting each token with its duration in
lockstep with the encoder, so its timestamps cannot drift from the audio.
Whisper's timestamps are predictions inside an autoregressive text stream.
Published long-form measurements put WhisperX at ~2.7s of accumulated shift
against ~250ms for forced alignment. A transcript that exists to be clicked on
is worthless if it drifts.

Parakeet is also the more accurate of the two on English benchmarks (6.32% vs
7.44% avg WER) and roughly an order of magnitude faster, but those are a bonus.
NeMo additionally supports decode-time phrase boosting over up to 20k terms,
which is the strongest available lever for biblical proper nouns — Whisper has
no equivalent, and its `initial_prompt` is close to useless for long audio
because the settings long files require confine it to the first window.

**What would flip this to Whisper:** Parakeet mangling biblical vocabulary even
with boosting on. Gate on entity error rate, not global WER — a 6% global WER
can hide a 40% failure rate on exactly the words that matter here.

**Verify in the pilot:** whether `timestamps=True` uses in-model TDT durations
or a forced-aligner path with an auxiliary CTC model. The model card and the
paper appear to describe different mechanisms, and it determines timestamp
quality directly.

## Three paths, by what each episode has

| Episodes | Path | Yields |
|---|---|---|
| ~250 with an official transcript | Forced alignment of known text | Correct words, speaker labels, accurate timing |
| ~278 without | Parakeet ASR | Timing and text |
| 51 with chapter markers | Validation | Independent drift measurement |

**Official transcripts carry no timing.** This was checked structurally on a
real transcript: 413 speaker labels, zero parenthesised timecodes, zero
SRT/VTT markers. They are speaker-labelled prose. So ASR or alignment is the
only source of timing, and the official text's role is to be the *input* to
alignment rather than an alternative to it. Aligning known text is a strictly
easier problem than recognising unknown text, so this path produces better
timing *and* better words than ASR alone.

The 51 episodes with publisher-authored `(MM:SS)` markers are ground truth we
did not have to make: ~600 independent checks. Regress the disagreement against
position in the episode — a constant offset is free to correct, a slope is
drift and is fatal.

## Error mining from the overlap (raised by the maintainer)

Run ASR on the ~250 episodes that already have official transcripts, even
though they do not need it. The diff between machine and human text is a
labelled error set: word-align the two, harvest substitution pairs, rank by
frequency. Recurring failures surface immediately because they repeat across
episodes.

Two uses, in this order:

1. **Feed the pairs to NeMo phrase boosting** so the error is prevented on the
   ~278 episodes with no official transcript. Prevention beats repair, and
   boosting cannot invent content.
2. **A post-hoc correction map** for what boosting still misses, gated on
   phonetic distance so it can only rewrite tokens that plausibly sound alike,
   never insert them.

Two hazards to build in from the start:

- **Not every diff is an ASR error.** Published transcripts are lightly edited —
  disfluencies dropped, false starts cleaned. The phonetic gate separates these:
  `um → ∅` is not a sound-alike, `chesed → hesed` is.
- **The list will be biased** toward the vocabulary of whichever books those 250
  episodes discussed. Seed the boost list from the proper-noun indexes already
  in `data/scripture/names/` as well.

This also yields a real accuracy number — WER across ~235 hours against human
text, per episode — rather than a sampled estimate. And its durable artifact is
a substitution table of a few thousand pairs, which is derived data rather than
a publisher's body.

## Pipeline

`pipelines/transcription/`, Python 3.11 venv, Modal 1.5.3. The venv is
gitignored; `uv` creates it.

- `build_inventory.mjs` — reads the installed resource manifest, writes the
  pipeline's input contract. The pipeline never reads the manifest directly: it
  is user data with its own schema and refusal rules, and a job on a rented GPU
  has no business depending on any of it. Keys on the record id, which is what
  makes a transcript re-attachable and "already done" unambiguous.
- `probe_audio.mjs` — HEADs every URL before any GPU is rented.
- `probe_durations.mjs` — ffprobe, exact durations; merged back into the
  inventory, which prefers measured over stated.
- `transcribe.py` — the Modal app.

Shape, and why:

- **Two stages.** CPU containers download into a Volume; GPU containers
  transcribe from it. CPU is ~5% of GPU cost, so network waiting is not billed
  at GPU rates; CDN concurrency stays capped at ~12 independently of GPU width;
  and a re-run re-downloads nothing.
- **`@app.cls` + `@modal.enter()`.** Model load is tens of seconds. Once per
  episode across 528 episodes that is hours of GPU time; once per container it
  is a rounding error. Largest single cost lever in the pipeline.
- **Idempotent by artifact existence**, filtered before dispatch, so a finished
  episode never becomes an input and costs nothing.
- **`timeout=900`.** The default is 300s and would kill the first real episode.
  It is also the blast-radius cap: ten containers hung simultaneously cost about
  $3 before they are killed.
- **`modal run --detach`, never `modal deploy`.** An ephemeral app cannot become
  a forgotten deployment quietly drawing down credit.
- Weights pre-warmed into a Volume by `download_model`, so ten GPU containers do
  not stampede HuggingFace at GPU rates.

## Cost

Not a constraint, contrary to the initial framing. Parakeet on an L4 is roughly
**$2** for all 495 hours; the Whisper path would be $7-21. The $30 Starter
credit is also *recurring monthly* rather than one-time. Two guards remain worth
setting: a workspace budget, and `max_containers=10` (which is also the Starter
ceiling).

Cheap mistakes are the real argument for the fast model: with idempotency, a
mid-run failure costs only the in-flight episodes.

## Open question — D5

`tasks/D5` guards: *No publisher bodies, descriptions, logos, artwork, remote
media, or embeds.* `docs/trusted-resource-permissions.md` already draws the line
for the near-identical Naked Bible case: **a transcript URL is catalogue
metadata; the text is a publisher's body.**

Storing verbatim transcripts conflicts with that as written. The maintainer has
stated permission, conditioned on not mischaracterizing the transcriptions —
hence `generated: true` and `model` on every record, so nothing downstream can
render machine output as human-authored without stripping provenance.

What still needs deciding is *where* transcripts live: outside the trusted-
resource manifest entirely, or as an amendment to it with a dated disclosure in
the way the audio capability was handled. The forced-alignment path additionally
requires holding official transcript text during processing, which is the
sharper end of the same question.

Note also that BibleProject's public terms contain no Creative Commons licence
and designate podcast audio stream-only, directing other uses to a written
request. `admin@bibleproject.com` is published and live. Given they already
publish transcripts for half the catalogue, asking for the rest is a plausible
ask that would beat ASR outright.

## Verification

- Pilot 10 episodes at low container count before any bulk run; extrapolate from
  the marginal per-episode time, not from total/10.
- Corpus-wide invariants, free on every episode: timestamps monotonically
  non-decreasing, `end > start` for every word, and the last word landing near
  the file duration — that last one catches truncation and gross drift across
  528 episodes without anyone listening.
- Drift regression against the 51 publisher-marker episodes.
- Entity error rate on biblical proper nouns, not global WER.
- Measure MP3 encoder delay once: encoders insert ~25ms of leading padding, and
  if ffmpeg and the browser disagree about trimming it, every timestamp in the
  app carries a constant offset that reads as "the highlight is always early."

## Guardrails

- No autonomous re-crawling. The pipeline runs when invoked.
- `generated: true` and the model id on every transcript record.
- Transcripts must never be presented as publisher-authored.
- Fetch concurrency stays bounded; one publisher serves all 528 files.
