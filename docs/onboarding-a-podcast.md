# Onboarding a podcast

Everything needed to take a publisher from "has audio" to "appears in the
margin with timestamped passage references". Written after doing it three
times — BibleProject (528 episodes, 495 hours), the Naked Bible Podcast (230
episodes, 222 hours) and Spoken Gospel (295 episodes, 254 hours) — so the order
below is the order that worked, and the warnings are things that actually went
wrong rather than things that might.

Roughly three hours of wall time per 500 episodes, and about $3 of GPU.

**Paths here are examples, not defaults worth trusting.** The scripts still fall
back to `/Volumes/External/Transcripts`, an external drive that is not always
mounted; every one of them takes an explicit path, and `~/Transcripts` is what
the last run used. What must not move is the library — `~/ScriptureLibrary`,
never anywhere iCloud syncs, because SQLite on synced storage is what caused the
freezes.

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

## 1. Import, then inventory

```bash
node --import tsx scripts/import-spoken-gospel-resources.ts        # or the publisher's own
node pipelines/transcription/build_inventory.mjs --source <sourceId> \
  --out ~/Transcripts/<source>-inventory.json \
  --durations ~/Transcripts/<source>-durations.json
```

The importer writes into `<library>/.artifacts/resources/<source>/`, and for a
feed-based publisher it writes **two** files:

- `manifest.json` — episodes whose title states a passage. This is the card
  catalogue, and a record cannot exist without `brefs`.
- `episodes.json` — every episode with audio. This is the audio catalogue.

**They are not the same list, and conflating them loses episodes silently.**
The pipeline used to build its inventory from the manifest, which meant "did the
publisher's title name a passage" was quietly deciding "does this episode have
speech in it". Spoken Gospel states a passage in 253 of 295 titles; the other 42
are Holy Week episodes, interviews and Q&As that discuss scripture for an hour
apiece. `build_inventory` prefers `episodes.json` where it exists and falls back
to the manifest where it does not, which is what the first two publishers ran
on.

Whether an episode deserves a card and whether it deserves a transcript are
different questions. The card asks what the publisher said it was about; the
reference extraction answers that far better by listening.

The pipeline still never reads the manifest directly — that is user data with
its own schema and refusal rules, and a job on a rented GPU has no business
depending on any of it. Everything downstream keys on the record id, which is
what makes a transcript re-attachable and "already done" an unambiguous
question.

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

**The bitrate trap, which has now caught me three times.** `probe_audio` derives
duration from `Content-Length` assuming 128kbps. When the real bitrate differs,
every episode looks like it carries the wrong recording — at a suspiciously
constant ratio. BibleProject had twelve 96kbps files (ratio 0.75 = 96/128);
Naked Bible is almost entirely 64kbps (0.52); Spoken Gospel runs 160–320kbps
and so reported 388 hours against a true 254, with 272 of 295 flagged as
disagreeing. **A constant ratio is the assumption being wrong, not the data**,
and it can be wrong in either direction — the first two under-reported, the
third over-reported.

Five ffprobe calls settle it in a minute; do that before believing anything the
byte estimate says. Where the feed states `itunes:duration` it agreed with
ffprobe to within 2%, so a feed-based publisher needs no full duration probe —
but it does need the seconds carried through, see below.

**`durationSeconds` must reach the inventory.** It is written into every
transcript as `audioSeconds`, and the reference extractor uses it to reject a
citation timestamped outside the episode. The extractor reads
`audioSeconds || Infinity`, so a missing runtime does not fail — it removes the
bound, and one of the three checks stops checking without saying so. The
inventory now falls back to the publisher's stated duration when ffprobe has not
run, and `pull_transcripts` repairs any transcript that came through without
one.

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

**One fetch in sixty dies on EPERM.** A Volume mount is per-container, not
per-input, and `fetch` runs two inputs per container — so one input calling
`reload()` moves the mount out from under the other's open file, and the failure
surfaces as a permission error that mentions nothing about concurrency. Retries
covered it (295/295 landed), and a lock around the two volume operations is the
actual fix. The download stays outside the lock, since waiting on a CDN is the
only part worth overlapping.

Then pull them down, repair, and install — one command, and safe to run while
the job is still going:

```bash
node pipelines/transcription/pull_transcripts.mjs --source <sourceId>
```

It pulls only the files for that source that are not already on disk, so it can
be run every few minutes to watch a run land. `modal volume get / --force`, what
this replaces, re-downloads every publisher's transcripts — hundreds of
megabytes — to collect whatever appeared since the last look.

On the way through it fills in any missing `audioSeconds` from the inventory,
refuses any transcript carrying no words, and reports coverage: the last word
should land near the end of the audio. All three corpora came in at 99.0–99.4%
median; anything much below is a truncated or failed episode.

---

## 4. Extract references with Codex

```bash
node --import tsx scripts/extract-refs-codex.ts \
  --source <sourceId> --episodes 400 --concurrency 6 --timeout-minutes 12 \
  --out ~/Transcripts/codex-refs-<source>.jsonl
```

`--episodes` above the transcript count takes them all; below it, the script
strides through the catalogue rather than taking its head, so a small number is
a spread sample rather than one series. **Start it while the transcription is
still running** — it reads whatever is installed, and a re-run picks up the rest
without redoing anything.

### Concurrency is capped by this machine's memory, not by the API

**Twelve workers on 16 GB. Not more.** Each concurrent `codex exec` costs
roughly 275 MB resident, and it is the node wrapper that holds it rather than
the native binary underneath.

Thirty-four workers wanted more than the machine had. Swap went to 23.4 GB of
24.6, the box began thrashing, and everything slowed down — including the
transcription running beside it. Killing the run took free memory from 25% back
to 71% and swap from 23.4 GB to 8.7, which is how the cause was confirmed rather
than guessed.

Two things that made this hard to see, both worth knowing:

- **Measuring the wrong process.** A `ps | grep codex` finds the native binaries
  at ~30 MB each and misses the node wrappers holding ten times that. The number
  to watch is total node RSS, not the codex processes.
- **A thrashing machine reports inflated per-process memory**, because paging
  churn shows up as resident set. The 618 MB/worker figure measured mid-thrash
  was itself a symptom; the real steady-state cost is ~275 MB.

It also produced a false performance finding. Throughput at 34 workers looked
like 69% scaling efficiency against a "soft server-side limit" — there was no
server-side limit. The machine was already paging, and the missing third was
swap.

**MCP servers are not the cause**, though thirteen of them are configured and
young `playwright-mcp` processes do appear during a run. Measured with four real
40 KB prompts: 2,707 MB of node RSS with them and 2,839 MB with
`-c mcp_servers={}`. The flag is not worth adding.

At twelve workers, expect roughly 6–7 episodes a minute and free memory around
30%. Watch free memory and swap rather than the episode counter: the first sign
of trouble is the whole machine getting slower, not the extraction failing.

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

**Codex hangs occasionally**, and there is now a timeout for it —
`--timeout-minutes`, twelve by default. Before it existed, two calls stalled
indefinitely and the rest of the batch sat behind them until `pkill -f
codex-darwin-arm64` released the workers by hand. A killed call costs one
episode, which a re-run picks up.

**Re-running resumes.** A second pass reads the output file, skips every episode
already in it, and carries those references forward — so the normal shape of
this step is: start it early against whatever has landed, run it again when the
transcription finishes, and pay once per episode. `--restart` forces a full
re-read. Resume is keyed on the episode, not on its references, so an episode
that legitimately yielded nothing stays done rather than being retried forever.

---

## 5. Install

```bash
cat ~/Transcripts/codex-refs-*.jsonl > ~/Transcripts/codex-refs-combined.jsonl
node --import tsx scripts/install-references.ts \
  --from ~/Transcripts/codex-refs-combined.jsonl
```

**Install from every publisher's file at once.** The per-episode files are keyed
by record id and merge harmlessly, but the inverse index is rebuilt from
whatever is passed — install one source alone and the index covers only that
source.

Episode facts — the title, the audio URL, the link a moment opens — come from
the manifest and then from `episodes.json`, for every id in
`TRANSCRIPT_APPROVED_SOURCES`. Reading the grant list rather than a second list
of names is deliberate: a source added to the grant and forgotten here would
transcribe and extract perfectly, and then have every one of its moments dropped
for want of an audio URL, which is a failure with no error message anywhere.

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
the second overturned a design the first had made look obvious. Four corpora in,
one measure has survived and every other candidate has died.

- **Duration is the invariant.** Median extent, by corpus: BibleProject 36s,
  Naked Bible 30s, Spoken Gospel 30s, 40 Minutes in the OT 35s. Four shows with
  very different formats land within six seconds of each other. It is the only
  quantity yet measured that means the same thing across publishers, and it is
  what the index ranks on.
- **Relation counts describe teaching style, not content.** `subject` share:
  BibleProject 55%, Naked Bible 11%, Spoken Gospel 24%. A thematic show lands on
  many passages briefly; a verse-by-verse show works one deeply and reaches
  outward. Do not rank on relation.
- **Share of episode describes episode length.** A `subject` occupies 3.1% of a
  BibleProject episode and 12.7% of a Naked Bible one. Do not rank on share.
- **Reference density describes format too.** 28.2 references an episode from
  Spoken Gospel against 15.1 from 40 Minutes in the OT — the same finding as
  relation counts wearing different clothes. A passage is not better attested
  because the show that mentioned it talks quickly.

---

## Costs and timings, measured

| | BibleProject | Naked Bible | Spoken Gospel |
|---|---|---|---|
| Episodes | 528 | 230 | 295 |
| Audio | 495.3 h | 222.1 h | 254.3 h |
| Transcription | ~1 h wall, ~$3 | ~30 min, ~$1.50 | ~50 min, ~$2 |
| Extraction | ~3 h wall | ~1.5 h | ~1.2 h |
| References | 15,252 | 7,703 | 8,333 |
| Rejected | 5 | 15 | 0 |

Transcription scales with audio hours and costs about $3 per 500 hours on an L4.
Extraction scales with *episode count* rather than hours — roughly 105 seconds
per episode per worker, so at the twelve-worker ceiling above, about 6.5 episodes
a minute regardless of how long they are.

The 2,469-episode batch of five shows added later took about 2 hours to
transcribe 1,074 hours, and the extraction is the long pole at roughly 6 hours.
Budget by episodes, not by hours.

Embedding (`scripts/index-transcripts.ts`) is a separate, optional path that
powers question search rather than references. It runs locally at ~16
windows/second and must stay local: query and document vectors have to come from
the same model, and the ways to break that quietly — a quantised build drifting
from fp32, a task prefix applied on one side only, a Matryoshka dimension chosen
differently — all degrade retrieval while appearing to work.
