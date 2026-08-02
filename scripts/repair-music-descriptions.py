#!/usr/bin/env python3
"""
Put the first words back on Poor Bishop Hooper's album descriptions.

    python3 scripts/repair-music-descriptions.py

THE DEFECT. The hero on an album page opened with "is a collection of
psalm-based songs." — a sentence with no subject, which is the sort of thing
that makes a finished screen read as a placeholder. Five of the thirteen
descriptions were like it: "was our first release", "is a three-album series",
"to help the curious better understand".

WHY. The capture that built this catalogue read the listen page's own DOM, and
that page sets the album's name as its own styled element at the head of the
paragraph. Taking the paragraph's remaining text nodes drops exactly one word —
the one the sentence is about — and the result still reads like prose, so
nothing flagged it.

THE REPAIR, and why it is a fetch rather than a fix-up. The obvious patch is to
prepend the album's name when the text starts lowercase, and it would be wrong:
"Golgotha to help the curious better understand" is missing more than a name,
so the guess would produce a sentence the publisher never wrote and we would
have no way to tell which of the thirteen were invented. Each album has a page
of its own at /projects/<slug>, and its meta description is the publisher's own
blurb, whole. So the words come from them.

The album pages are read once, here, and only the text is committed. Nothing
about this runs in the app.
"""

# `str | None` in a signature is evaluated at def time before 3.10.
from __future__ import annotations

import html
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "data/music/poor-bishop-hooper.json"
PAGE = "https://www.poorbishophooper.com/projects/{slug}"
AGENT = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Pericope/1.0"}
META = re.compile(r'<meta content="([^"]*)" name="description"\s*/?>')


def described(slug: str) -> str | None:
    request = urllib.request.Request(PAGE.format(slug=slug), headers=AGENT)
    with urllib.request.urlopen(request, timeout=45) as response:
        page = response.read().decode("utf-8", "replace")
    found = META.search(page)
    return html.unescape(found.group(1)).strip() if found else None


def main() -> None:
    """
    Splice the missing head back on, and prove the splice before keeping it.

    LENGTH IS THE WRONG TEST — the first attempt used it and repaired nothing.
    Our text is LONGER than the meta description, because ours is the whole
    paragraph off the listen page and theirs is a summary. Ours is simply
    missing its first words.

    So: take the opening of what we hold, find it inside what they wrote, and
    everything before that point is exactly what the capture dropped. It is a
    splice with evidence — if our opening is not in their sentence the two are
    not the same prose and nothing is touched, which is the case that would
    otherwise invent a sentence nobody wrote.
    """
    catalogue = json.loads(CATALOGUE.read_text())
    repaired = fine = stuck = 0
    for album in catalogue["albums"]:
        slug = album.get("slug")
        was = album.get("about")
        if not slug or not was:
            continue
        # A description that starts with a capital starts with its own subject.
        if was[:1].isupper():
            fine += 1
            continue
        blurb = described(slug)
        if not blurb:
            print(f"  --   {album['name']}: no description on their page")
            stuck += 1
            continue
        head = was[:40]
        at = blurb.find(head)
        if at <= 0:
            print(f"  ??   {album['name']}: their blurb does not contain ours; left alone")
            stuck += 1
            continue
        album["about"] = blurb[:at] + was
        repaired += 1
        print(f"  fix  {album['name']}: +{blurb[:at]!r}")
    CATALOGUE.write_text(json.dumps(catalogue, indent=1, ensure_ascii=False) + "\n")
    print(f"\n{repaired} repaired, {fine} already whole, {stuck} still short")


if __name__ == "__main__":
    main()
