#!/usr/bin/env python3
"""
Read one colour out of each series cover, so a show's page can be coloured by
its own artwork the way an album's already is.

    python3 scripts/compute-cover-tints.py

WHY THIS EXISTS. The album shelf has carried a `tint` per record since the
music import, and the field under an album hero is the thing the maintainer
singled out as working. The series pages had no equivalent — same layout, no
colour — which is why they read as the poor relation of two pages that are
supposed to be siblings. The covers are right there; nobody had asked them.

WHAT IT DOES NOT DO. It does not recompute album tints. Those are good, they
were approved on sight, and a "while we're here" pass over work that is already
right is how you lose it.

THE COLOUR IT PICKS is the dominant one rather than the average. Averaging is
the obvious move and it is wrong: the mean of a cover with a red figure on a
grey field is mud, and every mud is the same mud, so fourteen records end up
sharing one brown. Median-cut quantisation to ten buckets, then the bucket with
the best population-times-colourfulness score, keeps a cover's actual colour —
and the guard against near-white and near-black buckets stops a page taking its
identity from a paper margin the illustrator left around the art.

Covers are fetched ONCE, here, at author time, and only the six-digit result is
committed. Nothing about this runs in the app.
"""

import colorsys
import json
import pathlib
import urllib.request
from io import BytesIO

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT / "data/music/series-art.json"

# A publisher's CDN answers a default urllib agent with 403 about half the time.
AGENT = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Pericope/1.0"}


def dominant(image: Image.Image) -> str:
    """The one colour a listener would say the cover 'is'."""
    small = image.convert("RGB").resize((96, 96))
    quantised = small.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
    palette = quantised.getpalette() or []
    best_score, best_rgb = -1.0, (0, 0, 0)
    for count, index in quantised.getcolors() or []:
        r, g, b = palette[index * 3 : index * 3 + 3]
        _, saturation, value = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # Population is the honest signal; colourfulness breaks the tie. A bucket
        # that is nearly paper or nearly ink is usually the mount, not the art,
        # so it has to win on volume alone to be chosen.
        edge = 1.0 if 0.12 < value < 0.94 else 0.3
        score = count * (0.35 + saturation) * edge
        if score > best_score:
            best_score, best_rgb = score, (r, g, b)
    return "#%02x%02x%02x" % best_rgb


def main() -> None:
    entries = json.loads(ART.read_text())
    out: dict[str, dict[str, str]] = {}
    for source_id, value in entries.items():
        cover = value if isinstance(value, str) else value["cover"]
        request = urllib.request.Request(cover, headers=AGENT)
        with urllib.request.urlopen(request, timeout=45) as response:
            image = Image.open(BytesIO(response.read()))
            tint = dominant(image)
        out[source_id] = {"cover": cover, "tint": tint}
        print(f"{tint}  {source_id}")
    ART.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
