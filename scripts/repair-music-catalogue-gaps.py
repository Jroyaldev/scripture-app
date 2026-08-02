#!/usr/bin/env python3
"""
Three gaps in the music catalogue, each of which shows on a finished screen.

    python3 scripts/repair-music-catalogue-gaps.py

None of these are rendering bugs. They are places where the import left a field
empty and the room, doing exactly what it was told, drew the emptiness.

── ONE. The newest record sorts last ──────────────────────────────────────────

`All My Delight` came through with no `released` and no `slug`. The shelf sorts
by release year descending, `year(None)` is null, null becomes 0, and 0 sorts
after 2014 — so the record the publisher put out most recently sits in the last
cell of the shelf, under a hero with no year on it. The shelf's whole claim is
"what is new"; it was answering with the opposite.

The date comes from their own project page, which is where every other album's
came from. It is June 25, 2026 — genuinely the newest thing here.

WHAT IS NOT REPAIRED, and why that is the honest answer. The same page carries
its Music Credits, Visual Credits, and description blocks EMPTY — all three are
`w-dyn-bind-empty` on their side, where every other album fills all three. The
publisher has not written them yet. So `about` and `credits` stay absent rather
than invented; the hero's About expander and credits line are both conditional
and simply will not draw. A description we wrote for them would read as theirs.

The tint is also left alone, and that too was checked rather than assumed:
every bucket in a ten-way median cut of the cover comes back at S=0.000. It is
a black-and-white sleeve, `#000000` is the true reading, and the ground system
multiplies chroma rather than flooring it — so this record stays grey instead
of resolving an undefined hue to red. That is the same rule that keeps BEMA's
card grey, working as intended.

── TWO. A group of one, wedged into the middle of the Psalter ─────────────────

`Psalm 83 (instrumental)` carries the group `Other` and a Webflow PLACEHOLDER
SVG for its cover. Since the album page orders groups by first appearance, that
one-track group lands between `Book 3 · Instrumental` and `Book 4`, so the
instrumental half of EveryPsalm reads Book 1, Book 2, Book 3, Other, Book 4,
Book 5 — with the odd one out wearing a grey placeholder next to five painted
book covers.

Psalm 83 is in Book 3 of the Psalter (73–89). It was never an "other"; it was
a psalm whose group the import failed to read. It joins Book 3, and takes Book
3's cover with it, which makes the `Other` group disappear on its own.

── THREE. Four psalms that do not know their own number ───────────────────────

The import read psalm numbers with a pattern that wanted `PSALM 119 - ALEPH`
exactly, so it missed every title with anything after the stanza — the three
119 instrumentals — and `Psalm 119 - Sin And Shin`, whose stanza is two letters.
Those four tracks reach the reading canvas carrying no passage at all.

The stanza for Sin And Shin is not a guess. The album's stanzas run 1 through
20 and then jump to 22 (Taw); 21 is the only hole in the acrostic, and ש is the
letter that serves as both Sin and Shin. The number was always there in the
shape of what was missing.

Read once, written once. Nothing about this runs in the app; it is safe to run
again, and says so when there is nothing left to do.
"""

from __future__ import annotations

import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "data/music/poor-bishop-hooper.json"
PAGE = "https://www.poorbishophooper.com/projects/{slug}"
AGENT = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Pericope/1.0"}
RELEASED = re.compile(
    r'heading-style-h6">Release Date</div></div><div>([^<]+)</div>'
)

# The record with no filing, and the slug its own site files it under.
LATE = "All My Delight"
LATE_SLUG = "all-my-delight"

# Psalm 83 is Book 3 of the Psalter (73-89), not an "other".
STRAY = "Psalm 83 (instrumental)"
STRAY_HOME = "Book 3 · Instrumental"

# The four the import's pattern could not read, and what they are.
UNNUMBERED = {
    "Psalm 119 - Sin And Shin": (119, 21),
    "Psalm 119 - Aleph (instrumental)": (119, 1),
    "Psalm 119 - Gimel (instrumental)": (119, 3),
    "Psalm 119 - Lamedh (instrumental)": (119, 12),
}


def released_on(slug: str) -> str | None:
    """The publisher's own release date, off the publisher's own page."""
    request = urllib.request.Request(PAGE.format(slug=slug), headers=AGENT)
    with urllib.request.urlopen(request, timeout=45) as response:
        page = response.read().decode("utf-8", "replace")
    found = RELEASED.search(page)
    return found.group(1).strip() if found else None


def album(catalogue: dict, name: str) -> dict | None:
    for record in catalogue["albums"]:
        if record["name"] == name:
            return record
    return None


def main() -> None:
    catalogue = json.loads(CATALOGUE.read_text())
    done = 0

    # ONE — the newest record's filing.
    late = album(catalogue, LATE)
    if late is None:
        print(f"  ??   {LATE}: not in the catalogue; skipped")
    elif late.get("released") and late.get("slug"):
        print(f"  --   {LATE}: already filed")
    else:
        when = released_on(LATE_SLUG)
        if not when:
            print(f"  ??   {LATE}: no release date on their page; left alone")
        else:
            late["released"] = when
            late["slug"] = LATE_SLUG
            done += 1
            print(f"  fix  {LATE}: released {when!r}, slug {LATE_SLUG!r}")

    # TWO — the group of one.
    psalms = album(catalogue, "EveryPsalm")
    if psalms is None:
        print("  ??   EveryPsalm: not in the catalogue; skipped")
    else:
        home = next(
            (t for t in psalms["tracks"] if t.get("group") == STRAY_HOME), None
        )
        stray = next((t for t in psalms["tracks"] if t["title"] == STRAY), None)
        if stray is None:
            print(f"  ??   {STRAY}: not in EveryPsalm; skipped")
        elif stray.get("group") == STRAY_HOME:
            print(f"  --   {STRAY}: already in {STRAY_HOME}")
        elif home is None:
            print(f"  ??   {STRAY_HOME}: no such group to join; left alone")
        else:
            stray["group"] = STRAY_HOME
            # And the book's cover with it, or it keeps the placeholder.
            if home.get("cover"):
                stray["cover"] = home["cover"]
            done += 1
            print(f"  fix  {STRAY}: joins {STRAY_HOME}")

        # THREE — the four with no number.
        for track in psalms["tracks"]:
            wanted = UNNUMBERED.get(track["title"])
            if wanted is None or track.get("psalm") is not None:
                continue
            track["psalm"], track["stanza"] = wanted
            done += 1
            print(f"  fix  {track['title']}: psalm {wanted[0]}, stanza {wanted[1]}")

    if not done:
        print("\nnothing left to repair")
        return
    CATALOGUE.write_text(json.dumps(catalogue, indent=1, ensure_ascii=False) + "\n")
    print(f"\n{done} repaired")


if __name__ == "__main__":
    main()
