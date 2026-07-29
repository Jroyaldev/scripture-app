# Onboarding a podcast

Everything needed to take a publisher from "has audio" to "appears in the
margin with timestamped passage references". Written after doing it twice —
BibleProject (528 episodes, 495 hours) and the Naked Bible Podcast (230
episodes, 222 hours) — so the order below is the order that worked, and the
warnings are things that actually went wrong rather than things that might.

Roughly three hours of wall time per 500 episodes, and about $3 of GPU.

---

## 0. The grant comes first, and it is enforced

Nothing else runs without it. `TRANSCRIPT_APPROVED_SOURCES` in
`src/core/transcripts.ts` names the publishers who have granted transcripts,
and every loader refuses a record id belonging to anyone else — before opening
a file, so an ungranted transcript has no path to a reader even if one is
sitting on disk. The transcription pipeline skips them before downloading.

Adding a source means two edits and they are held together by a test:

1. Add the id to `TRANSCRIPT_APPROVED_SOURCES`.
2. Record the grant in `docs/trusted-resource-permissions.md` under
   `## Transcripts`, with the date.

`tests/transcripts.test.ts` fails if the code names a source the doc does not.
That test exists because a capability shipping as though it had been granted is
the failure worth making impossible, not the one worth remembering.

The source also needs `mediaHosts` in its manifest and its audio host in the
renderer's CSP (`src/renderer/index.html`) or nothing will play — those are the
audio grant, which is separate and may predate the transcript grant.

---

## 1. Inventory

```bash
node pipelines/transcription/build_inventory.mjs --source <sourceId>
```

Reads the installed resource manifest and writes the pipeline's input contract
to `/Volumes/External/Transcripts/<source>-inventory.json`. The pipeline never
reads the manifest directly — that is user data with its own schema and refusal
rules, and a job on a rented GPU has no business depending on any of it.

Everything downstream keys on the manifest's record id, which is what makes a
transcript re-attachable and makes "already done" an unambiguous question.

---

## 2. Probe before renting anything

```bash
node pipelines/transcription/probe_audio.mjs \
  --inventory /Volumes/External/Transcripts/<source>-inventory.json \
  --out /Volumes/External/Transcripts/<source>-audio-probe.json

node pipelines/transcription/probe_durations.mjs \
  --inventory /Volumes/External/Transcripts/<source>-inventory.json \
  --out /Volumes/External/Transcripts/<source>-durations.json
```

A dead URL found here costs nothing. Found mid-run it costs a container, a
retry, and money.

**The bitrate trap, which caught me twice.** `probe_audio` derives duration from
`Content-Length` assuming 128kbps. When the real bitrate differs, every episode
looks like it carries the wrong recording — at a suspiciously constant ratio.
BibleProject had twelve 96kbps files (ratio 0.75 = 96/128); Naked Bible is
almost entirely 64kbps (ratio 0.52). **A constant ratio is the assumption being
wrong, not the data.** `probe_durations` reads the container with ffprobe and
needs no assumption; trust it and re-run `build_inventory` afterwards so the
measured durations land in the inventory.

---

## 3. Transcribe on Modal

```bash
cd pipelines/transcription
.venv/bin/python -m modal run transcribe.py::download_model      # once, ever
.venv/bin/python -m modal run --detach transcribe.py \
  --inventory /Volumes/External/Transcripts/<source>-inventory.json
```

`--detach` is not optional for a real run: it survives the laptop sleeping. Use
`modal run`, never `modal deploy` — an ephemeral app cannot become a forgotten
deployment quietly drawing down credit.

Two stages by design. CPU containers download into a Volume; GPU containers
transcribe from it. CPU is a twentieth of GPU's rate, so network waiting is not
billed at GPU prices; CDN concurrency stays capped independently of GPU width;
and a re-run re-downloads nothing.

Idempotent by artifact: an episode whose transcript already carries a word never
becomes an input. Requiring a *word* rather than a *file* is deliberate — an
early bug wrote well-formed but empty transcripts, and existence-only caching
would have marked exactly the ruined episodes as finished forever.

Model is `nvidia/parakeet-tdt-0.6b-v3` on an L4. Chosen over Whisper because it
is frame-synchronous: it emits each token with a duration in lockstep with the
encoder, so timestamps cannot drift. Measured — every word start lands on an
80ms frame boundary, which is the signature of the duration head rather than a
forced aligner.

Then pull them down and check:

```bash
.venv/bin/python -m modal volume get asr-transcripts / /Volumes/External/Transcripts/raw --force
node pipelines/transcription/check_transcripts.mjs
cp /Volumes/External/Transcripts/raw/<source>__*.json ~/ScriptureLibrary/.artifacts/transcripts/
```

`check_transcripts` verifies coverage (words should reach ~99% of the file
duration), monotonic timestamps, and that every transcript declares itself
machine-made. Both corpora came in at 99.3–99.4% median coverage; anything much
below that is a truncated or failed episode.

---

## 4. Extract references with Codex

```bash
node --import tsx scripts/extract-refs-codex.ts \
  --source <sourceId> --episodes <n> --concurrency 8 \
  --out /Volumes/External/Transcripts/codex-refs-<source>.jsonl
```

The prompt lives in that file and **is the valuable part** — it is what
produced 22,955 references at a 0.03% rejection rate. It asks for one entry per
place a passage is discussed, with a relation (`subject` / `crossref` /
`mention` / `allusion`), a start and end timestamp, and a verbatim quote.

Three checks run on every returned reference before it is kept: the book must
resolve to a canonical code, the timestamp must fall inside the runtime, and
**the quoted evidence must appear verbatim in the transcript that was sent**.
That last one is what turns a model's output into data — a verdict with a
quotation can be verified in milliseconds; one without can only be believed.

Writes incrementally, so a hung call costs one episode rather than the batch.

**Codex hangs occasionally.** Twice a call stalled indefinitely and blocked its
worker; the fix each time was `pkill -f codex-darwin-arm64`, which releases the
worker and lets the rest finish. A per-call timeout would prevent it and is not
yet written.

---

## 5. Install

```bash
cat /Volumes/External/Transcripts/codex-refs-*.jsonl \
  > /Volumes/External/Transcripts/codex-refs-combined.jsonl
node --import tsx scripts/install-references.ts \
  --from /Volumes/External/Transcripts/codex-refs-combined.jsonl
```

**Install from every publisher's file at once.** The per-episode files are keyed
by record id and merge harmlessly, but the inverse index is rebuilt from
whatever is passed — install one source alone and the index covers only that
source.

This writes per-episode references to `.artifacts/references/` and the
passage → moments index to `.artifacts/passage-index.json`. It also normalises
full-chapter ranges: Genesis 1 has 31 verses, so "1-31" and "the whole chapter"
are one claim written two ways, and left alone they land in different sections
purely by how a reference happened to be recorded.

Nothing else is needed. The loaders gate on source and the key format is shared,
so a newly installed publisher's episodes resolve immediately.

---

## What to check on a new corpus

Everything in the ranking was tuned on two publishers with opposite formats, and
the second overturned a design the first had made look obvious. Assume a third
will do it again.

- **Relation counts describe teaching style, not content.** 55% of BibleProject
  references are `subject`; 11% of Naked Bible's are. A thematic show lands on
  many passages briefly; a verse-by-verse show works one deeply and reaches
  outward. Do not rank on relation.
- **Share of episode describes episode length.** A `subject` occupies 3.1% of a
  BibleProject episode and 12.7% of a Naked Bible one. Do not rank on share.
- **Duration is the invariant.** The two corpora's distributions sit almost on
  top of each other — median 36 seconds against 30. It is the only quantity
  measured so far that means the same thing across publishers, and it is what
  the index ranks on.

---

## Costs and timings, measured

| | BibleProject | Naked Bible |
|---|---|---|
| Episodes | 528 | 230 |
| Audio | 495.3 h | 222.1 h |
| Transcription | ~1 h wall, ~$3 | ~30 min, ~$1.50 |
| Extraction | ~3 h wall | ~1.5 h |
| References | 15,252 | 7,703 |
| Rejected | 5 | 15 |

Embedding (`scripts/index-transcripts.ts`) is a separate, optional path that
powers question search rather than references. It runs locally at ~16
windows/second and must stay local: query and document vectors have to come from
the same model, and the ways to break that quietly — a quantised build drifting
from fp32, a task prefix applied on one side only, a Matryoshka dimension chosen
differently — all degrade retrieval while appearing to work.
