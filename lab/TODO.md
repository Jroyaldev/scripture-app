# Pattern shapes · open work

## 1. Translation fragility of user marks — NEXT ENGINEERING TASK

User-authored marks anchor by `{ref, phrase, occ}` captured from the rendered
translation (WEB). Switch to KJV and `"his delight is in Yahweh's law"` does not
exist — the mark silently fails to resolve. Built-in patterns dodge this by
curating phrase keys per the INV-5 rule (offsets computed per translation at
render), but user captures are inherently single-translation.

Plan of attack:
- The app already solved this class of problem for selections — see the
  "Preserve selection through version picker" and "Keep selected quote through
  translation changes" work on `codex/desktop-visual-system`. Reuse that
  anchoring machinery (canonical/word-level anchors) for mark members.
- Store the capture translation on the record (`src: "web"`); resolve to other
  translations via the existing alignment path.
- Graceful degradation UX when a member cannot resolve: render the member as
  *absence* in the card (dimmed row, "not found in KJV"), never silently drop;
  offer a one-click "remap in this translation" that reopens the selection
  session for that member.

## 2. Marks library — DEFERRED until authoring is well established

All user patterns across studies in one place: searchable list, jump-to,
kind filter, `shape-marks.jsonl` export/import. Direction agreed: not a
manager screen — a *commonplace book*: marks in the order made, with their
notes, each entry rendered in the export-card grammar. Revisit once the
marking feature has settled.

## 3. Rest-state collision policy — first pass shipped

Shared words now rest in neutral gold ("more than one shape lives here")
instead of arbitrarily wearing the first pattern's hue. Still open:
partially-overlapping phrases produce per-segment tint seams; light/dark
tint strengths may need further tuning per theme.

## 4. Chapter skeleton / semantic zoom (design discussion open)

Zoom out: text fades, shapes remain — the chapter as its own diagram.
With 8+ patterns live in Psalm 1 the shape-of-the-shapes is now the
interesting object. Likely the lab's next big view.

Relationship to the marks library (they are distinct): the library is
*your collection without the text* (unit: the mark; question: "what have
I seen?"); the skeleton is *the text's shape without the words* (unit:
the passage; question: "what shape is this chapter?"). Both draw from the
same records. The skeleton is really the reading view at a different
altitude — built-ins and user marks alike appear in it — and its endgame
is comparison: chapter skeletons side by side (Psalm 1 next to Psalm 2;
all 150 psalms as a wall) where frames, chiasms, and acrostics become
visible to the naked eye.

## 5. Light theme premium pass (in progress)

Dark themes are cinematic; light read as whitewashed beige. First
iteration shipped in the lab (deeper ground #EDE4D1, brighter paper
#FCF9F1, real elevation shadows, ink-deep hues, hint-mix 58%) — the lab
light theme now intentionally diverges from design-tokens.json as a
proposal. If it holds up, feed the values back into the app tokens.
