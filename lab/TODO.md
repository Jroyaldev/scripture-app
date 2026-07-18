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

## 2. Marks library (design discussion open)

All user patterns across studies in one place: searchable list, jump-to,
kind filter, `shape-marks.jsonl` export/import. The pcard row grammar is
already the row design. Question: standalone view or a rail mode?

## 3. Rest-state collision policy (design discussion open)

A word covered by two patterns wears the first pattern's tint arbitrarily.
Needs a rule — strongest-kind-wins, neutral ink for shared words, or a subtle
blend. Related: partially-overlapping phrases produce per-segment tint seams.

## 4. Chapter skeleton / semantic zoom (design discussion open)

Zoom out: text fades, shapes remain — the chapter as its own diagram.
With 8+ patterns live in Psalm 1 the shape-of-the-shapes is now the
interesting object. Likely the lab's next big view.
