"""
Batch transcription of the BibleProject podcast on Modal.

Run order:

    modal run transcribe.py::download_model      # once, cheap, CPU only
    modal run transcribe.py --limit 10           # pilot, well under $1
    modal run --detach transcribe.py             # the real thing
    modal volume get asr-transcripts / /Volumes/External/Transcripts/raw

WHY THE SHAPE IS THE SHAPE

Two stages, split by what they are bottlenecked on. Stage one downloads mp3s on
CPU containers into a Volume; stage two transcribes from the Volume on GPU. The
split matters for three reasons: CPU containers cost ~5% of a GPU's rate, so
network waiting is not billed at GPU prices; CDN concurrency stays capped at ~12
independently of how wide the GPU stage runs, which is the difference between
using a publisher's bandwidth and abusing it; and a re-run re-downloads nothing.

Idempotency is by artifact existence, filtered before dispatch. An episode whose
transcript is already in the Volume never becomes an input, so it costs no
container and no GPU second. That is a budget property as much as a correctness
one: a run that dies halfway and is restarted pays only for what it had not
finished, rather than for everything twice.

Everything is keyed on the library's own record id. That is what lets a finished
transcript be attached back to the record it came from, and what makes "already
done" a question with an unambiguous answer.

MODEL

Parakeet TDT rather than Whisper, for one reason that outweighs word error rate:
it is a frame-synchronous transducer, emitting each token together with its
duration in lockstep with the encoder. Whisper's timestamps are predictions
inside an autoregressive text stream and can drift arbitrarily from the audio —
measured at multiple seconds on long-form input, against ~250ms for forced
alignment. This transcript exists to be clicked on, so a timestamp that drifts
is a transcript that lies about where a word is. Parakeet is also the more
accurate of the two on English benchmarks, and roughly an order of magnitude
faster, but those are a bonus rather than the argument.
"""

import json
import os
import pathlib
import shutil
import urllib.request

import modal

# --- constants ---------------------------------------------------------------

MODEL_NAME = "nvidia/parakeet-tdt-0.6b-v3"
MODEL_DIR = "/models"
AUDIO_DIR = "/audio"
OUT_DIR = "/transcripts"

# Long enough that a 99-minute episode cannot be cut off, short enough that a
# hung container is bounded. The default is 300s, which would kill the very
# first real episode; this is the setting most likely to be wrong by omission.
TRANSCRIBE_TIMEOUT = 900
FETCH_TIMEOUT = 1800

# Window length and overlap for long audio. Ten minutes keeps encoder memory
# well inside a 24GB L4 regardless of how long the episode is; ten seconds of
# overlap is far more than any single word needs, which is the point — the
# merge boundary sits in the middle of it, so no word is ever near an edge.
CHUNK_SECONDS = 600
OVERLAP_SECONDS = 10

# The Starter plan's ceiling on concurrent GPUs is 10, so this is the platform's
# number rather than a tuned one.
MAX_GPU_CONTAINERS = 10
# Deliberately lower. Every episode comes from one host; this stage's job is to
# be unremarkable to it.
MAX_FETCH_CONTAINERS = 6

# NeMo needs system CUDA/cuDNN, not just the pip-bundled runtime, so this starts
# from an NVIDIA image rather than debian_slim.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04", add_python="3.12"
    )
    # nemo_toolkit[asr] pulls in texterrors, which builds a pybind11 C++11
    # extension from source. Two things have to be true for that to work, and
    # neither is by default: a C++ compiler must exist, and distutils must be
    # able to find it. Modal's add_python installs a standalone Python whose
    # recorded build compiler is not present in this image, so the extension
    # build probes for a compiler that does not exist and reports it as
    # "Unsupported compiler" — which reads like a version problem and is not.
    # CC/CXX override the recorded values; they must be set before the install,
    # not after, or the layer they belong to has already run.
    .apt_install("ffmpeg", "libsndfile1", "git", "build-essential", "g++", "clang")
    .env({"CC": "gcc", "CXX": "g++"})
    .uv_pip_install(
        "nemo_toolkit[asr]==2.5.0",
        "huggingface_hub[hf_transfer]==0.35.3",
        "soundfile==0.13.1",
        "librosa==0.11.0",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HUB_CACHE": MODEL_DIR})
)

app = modal.App("bibleproject-asr", image=image)

# Weights live in a Volume rather than the image: an image rebuild re-downloads
# every layer after the changed one, and these are gigabytes.
model_volume = modal.Volume.from_name("asr-models", create_if_missing=True)
audio_volume = modal.Volume.from_name("asr-audio", create_if_missing=True)
out_volume = modal.Volume.from_name("asr-transcripts", create_if_missing=True)


# --- stage 0: warm the weights ------------------------------------------------


@app.function(volumes={MODEL_DIR: model_volume}, timeout=1800)
def download_model() -> str:
    """Fetch the weights once, on a CPU container.

    Without this, the first real run has ten GPU containers hitting HuggingFace
    simultaneously and paying GPU rates to wait on a download.
    """
    from huggingface_hub import snapshot_download

    path = snapshot_download(MODEL_NAME)
    model_volume.commit()
    return path


# --- stage 1: fetch audio (CPU) ----------------------------------------------


@app.function(
    volumes={AUDIO_DIR: audio_volume},
    timeout=FETCH_TIMEOUT,
    max_containers=MAX_FETCH_CONTAINERS,
    retries=modal.Retries(max_retries=3, backoff_coefficient=2.0, initial_delay=5.0),
)
@modal.concurrent(max_inputs=2)
def fetch(episode: dict) -> dict:
    """Download one episode's mp3 into the audio Volume.

    Downloaded to /tmp rather than straight into the Volume, per Modal's
    guidance, then published in two steps: copy into the Volume under a
    .partial name, then replace. The replace is what matters — it is atomic
    only because both names are on the same filesystem, so a container dying
    mid-copy leaves a .partial that no later run mistakes for a finished file.

    os.rename cannot be used to cross from /tmp into the Volume: they are
    different devices and it fails with EXDEV, which is what the first pilot
    run discovered on all ten episodes at once.
    """
    key = _key(episode["id"])
    target = pathlib.Path(AUDIO_DIR) / f"{key}.mp3"

    audio_volume.reload()
    if target.exists() and target.stat().st_size > 0:
        return {"id": episode["id"], "status": "cached", "bytes": target.stat().st_size}

    staging = pathlib.Path("/tmp") / f"{key}.mp3"
    request = urllib.request.Request(
        episode["audioUrl"], headers={"User-Agent": "scripture-app/transcription"}
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        staging.write_bytes(response.read())

    size = staging.stat().st_size
    if size == 0:
        raise RuntimeError(f"empty download for {episode['id']}")

    partial = target.with_suffix(".mp3.partial")
    shutil.copyfile(staging, partial)
    os.replace(partial, target)
    staging.unlink(missing_ok=True)
    audio_volume.commit()
    return {"id": episode["id"], "status": "fetched", "bytes": size}


# --- stage 2: transcribe (GPU) -----------------------------------------------


@app.cls(
    gpu="L4",
    volumes={MODEL_DIR: model_volume, AUDIO_DIR: audio_volume, OUT_DIR: out_volume},
    timeout=TRANSCRIBE_TIMEOUT,
    max_containers=MAX_GPU_CONTAINERS,
    retries=2,
    scaledown_window=60,
)
class Transcriber:
    """One model load per container, not one per episode.

    Loading Parakeet and initialising CUDA costs tens of seconds. Paid once per
    episode across 528 episodes that is hours of GPU time spent on startup; paid
    once per container it is a rounding error. This is the single largest cost
    lever in the pipeline, and it is one decorator.
    """

    @modal.enter()
    def load(self) -> None:
        import nemo.collections.asr as nemo_asr

        os.environ["HF_HUB_CACHE"] = MODEL_DIR
        self.model = nemo_asr.models.ASRModel.from_pretrained(model_name=MODEL_NAME)
        self.model.eval()

        # Full self-attention is quadratic in sequence length, and an hour of
        # audio is a very long sequence. Local attention bounds each frame's
        # context to a window, which is what makes long files fit in 24GB at
        # all; conv chunking does the same for the subsampling stage, which is
        # exactly where the first attempt was killed.
        self.model.change_attention_model("rel_pos_local_attn", [128, 128])
        self.model.change_subsampling_conv_chunking_factor(1)

    @modal.method()
    def transcribe(self, episode: dict) -> dict:
        key = _key(episode["id"])
        destination = pathlib.Path(OUT_DIR) / f"{key}.json"

        out_volume.reload()
        # Existence is not completion. A bug that wrote well-formed but empty
        # transcripts would otherwise be permanently cached as finished work,
        # and every later run would skip the episodes it had ruined. Requiring
        # a word before believing the artifact makes a re-run the repair.
        if destination.exists():
            try:
                if json.loads(destination.read_text()).get("words"):
                    return {"id": episode["id"], "status": "cached"}
            except (ValueError, OSError):
                pass
            destination.unlink(missing_ok=True)

        source = pathlib.Path(AUDIO_DIR) / f"{key}.mp3"
        if not source.exists():
            return {"id": episode["id"], "status": "missing-audio"}

        # Decode to 16kHz mono once. The model wants it, and doing it here means
        # the mp3's own sample rate and channel count stop mattering — this
        # catalogue carries both 128kbps stereo and 96kbps 32kHz mono.
        wav = pathlib.Path("/tmp") / f"{key}.wav"
        os.system(
            f'ffmpeg -nostdin -loglevel error -y -i "{source}" '
            f'-ac 1 -ar 16000 -f wav "{wav}"'
        )
        if not wav.exists():
            return {"id": episode["id"], "status": "decode-failed"}

        duration = episode.get("durationSeconds") or _probe_seconds(wav)
        chunks = _cut(wav, key, duration)
        if not chunks:
            return {"id": episode["id"], "status": "chunk-failed"}

        outputs = self.model.transcribe(
            [str(c["path"]) for c in chunks], timestamps=True, batch_size=1
        )
        result = _shape(episode, _merge(chunks, outputs))

        for c in chunks:
            c["path"].unlink(missing_ok=True)

        destination.write_text(json.dumps(result, ensure_ascii=False))
        out_volume.commit()
        wav.unlink(missing_ok=True)

        return {
            "id": episode["id"],
            "status": "ok",
            "words": len(result["words"]),
            "segments": len(result["segments"]),
            "lastWordEnd": result["lastWordEnd"],
            "audioSeconds": episode.get("durationSeconds"),
        }


def _key(record_id: str) -> str:
    """Filesystem-safe key derived from the library's record id."""
    return record_id.replace(":", "__").replace("/", "_")


def _probe_seconds(path: pathlib.Path) -> float:
    import subprocess

    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=False,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def _cut(wav: pathlib.Path, key: str, duration: float) -> list[dict]:
    """Split into overlapping windows so encoder memory stops depending on
    episode length.

    The first attempt fed a 99-minute waveform to the encoder in one pass and
    the container was killed inside the subsampling convolution. Self-attention
    is quadratic in sequence length, so the longest episodes are precisely where
    that happens — and this catalogue runs to 99 minutes.

    Windows overlap because a hard cut lands mid-word roughly whenever it feels
    like it, and a word split across two windows is recognised correctly by
    neither. The overlap means every word is heard whole by at least one window;
    _merge then decides which window owns it.
    """
    starts, t = [], 0.0
    while t < duration:
        starts.append(t)
        t += CHUNK_SECONDS - OVERLAP_SECONDS

    chunks = []
    for index, start in enumerate(starts):
        path = pathlib.Path("/tmp") / f"{key}.{index:03d}.wav"
        os.system(
            f'ffmpeg -nostdin -loglevel error -y -ss {start:.3f} '
            f'-t {CHUNK_SECONDS} -i "{wav}" -ac 1 -ar 16000 -f wav "{path}"'
        )
        if path.exists() and path.stat().st_size > 0:
            chunks.append({"index": index, "start": start, "path": path})
    wav.unlink(missing_ok=True)
    return chunks


def _merge(chunks: list[dict], outputs: list) -> dict:
    """Stitch windows back into one timeline, without duplicating the overlap.

    Each window owns a half-open interval, and the boundary between two windows
    is placed at the middle of their overlap. Every word therefore comes from
    exactly one window — no duplicates, and no gap where a word could be
    dropped — and it comes from the window that heard the most context around
    it, since the middle of the overlap is the furthest point from either
    window's edge.

    This is simpler than the longest-common-subsequence merge NVIDIA uses. It
    cannot repair a word that both windows misheard, but it also cannot invent
    an alignment, and its failure mode is a single word attributed to the
    neighbouring window rather than a resynchronised transcript.
    """
    words, segments = [], []
    for position, chunk in enumerate(chunks):
        output = outputs[position]
        stamps = getattr(output, "timestamp", None) or {}
        offset = chunk["start"]

        lo = offset + (OVERLAP_SECONDS / 2 if position > 0 else 0.0)
        hi = (
            chunks[position + 1]["start"] + OVERLAP_SECONDS / 2
            if position + 1 < len(chunks) else float("inf")
        )

        for w in stamps.get("word", []):
            start = float(w.get("start", 0.0)) + offset
            if lo <= start < hi:
                words.append({"w": w.get("word", ""), "s": start,
                              "e": float(w.get("end", 0.0)) + offset})
        for s in stamps.get("segment", []):
            start = float(s.get("start", 0.0)) + offset
            if lo <= start < hi:
                segments.append({"t": s.get("segment", ""), "s": start,
                                 "e": float(s.get("end", 0.0)) + offset})

    return {"words": words, "segments": segments,
            "text": " ".join(s["t"] for s in segments).strip()}


def _shape(episode: dict, merged: dict) -> dict:
    """Normalise the merged windows into this pipeline's transcript format.

    Takes _merge's dict, not a raw NeMo hypothesis — the windows have already
    been stitched onto one timeline by the time this runs, and reaching for
    model attributes here silently yields nothing.

    The `generated` flag and `model` field are not decoration. These transcripts
    are machine output and have to remain honestly presentable as such — nothing
    downstream should be able to render one as though a person wrote it without
    going out of its way to strip the provenance.
    """
    words = [
        {"w": w["w"], "s": round(w["s"], 3), "e": round(w["e"], 3)}
        for w in merged.get("words", [])
    ]
    segments = [
        {"t": s["t"], "s": round(s["s"], 3), "e": round(s["e"], 3)}
        for s in merged.get("segments", [])
    ]
    # Sorted on the way out. The player picks a chapter by scanning for the last
    # start at or before the playhead and does not sort first, so unordered
    # spans would silently select the wrong one.
    words.sort(key=lambda w: w["s"])
    segments.sort(key=lambda s: s["s"])

    return {
        "schema": "transcript/v1",
        "generated": True,
        "model": MODEL_NAME,
        "id": episode["id"],
        "title": episode.get("title"),
        "audioUrl": episode.get("audioUrl"),
        "brefs": episode.get("brefs", []),
        "text": merged.get("text", ""),
        "words": words,
        "segments": segments,
        # The cheapest corpus-wide sanity check there is: if the last word lands
        # at 40 minutes in a 56-minute episode, that episode failed, and this
        # says so without anyone listening to it.
        "lastWordEnd": words[-1]["e"] if words else 0.0,
        "audioSeconds": episode.get("durationSeconds"),
    }


# --- driver -------------------------------------------------------------------


@app.local_entrypoint()
def main(limit: int = 0, inventory: str = "/Volumes/External/Transcripts/inventory.json",
         fetch_only: bool = False, dry_run: bool = False) -> None:
    episodes = json.loads(pathlib.Path(inventory).read_text())["episodes"]
    if limit:
        # The inventory is sorted longest-first, so a pilot taken off the top is
        # the pessimistic sample rather than a flattering one.
        episodes = episodes[:limit]

    hours = sum(e.get("durationSeconds") or 0 for e in episodes) / 3600
    print(f"{len(episodes)} episodes, {hours:.1f} audio hours")
    if dry_run:
        return

    fetched = list(fetch.map(episodes, return_exceptions=True))
    ok = [f for f in fetched if isinstance(f, dict) and f.get("status") in ("fetched", "cached")]
    print(f"audio ready: {len(ok)}/{len(episodes)}")
    for f in fetched:
        if not isinstance(f, dict):
            print(f"  fetch failed: {f}")
    if fetch_only:
        return

    ready = [e for e in episodes if any(o["id"] == e["id"] for o in ok)]
    results = list(Transcriber().transcribe.map(ready, return_exceptions=True))

    done = [r for r in results if isinstance(r, dict) and r.get("status") == "ok"]
    cached = [r for r in results if isinstance(r, dict) and r.get("status") == "cached"]
    print(f"\ntranscribed {len(done)}, already had {len(cached)}")

    # Coverage: the last word should land near the end of the audio. A big
    # shortfall means the episode was truncated or the model stopped early, and
    # it is worth knowing before the transcripts are trusted.
    for r in done:
        audio = r.get("audioSeconds")
        if audio and r["lastWordEnd"] < audio * 0.9:
            print(f"  SHORT {r['id']}: words end {r['lastWordEnd']:.0f}s of {audio:.0f}s")
    for r in results:
        if not isinstance(r, dict):
            print(f"  failed: {r}")
        elif r.get("status") not in ("ok", "cached"):
            print(f"  {r.get('status')}: {r.get('id')}")
