"""Can Modal's containers actually reach each publisher's CDN?

Local success proves nothing: a datacenter IP is a different client, and
substack refused ours with a 403 that never appeared from a laptop. This asks
from the network the job will actually run on, one URL per show, before any GPU
is rented against an inventory that cannot be fetched.
"""
import json, urllib.request, modal

image = modal.Image.debian_slim(python_version="3.12")
app = modal.App("cdn-reachability", image=image)

UAS = {
    "pipeline": "scripture-app/transcription",
    "browser": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
}


@app.function(timeout=300)
def probe(job: dict) -> dict:
    out = {"source": job["source"]}
    for label, ua in UAS.items():
        try:
            req = urllib.request.Request(job["url"], headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=60) as response:
                data = response.read(32 * 1024)
                out[label] = f"{response.status} {len(data)}B {response.url.split('/')[2]}"
        except Exception as error:
            out[label] = f"{type(error).__name__}: {error}"
    return out


@app.local_entrypoint()
def main(jobs: str = "") -> None:
    for result in probe.map(json.loads(jobs)):
        print(f"  {result['source']:30} pipeline-UA: {result['pipeline'][:52]}")
        print(f"  {'':30} browser-UA:  {result['browser'][:52]}")
