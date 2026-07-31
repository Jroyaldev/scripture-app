# Connections: the aesthetic history of the drawn connectors

Read-only archaeology of `/Users/jonnyroyal/dev/scripture-app-quire` (.git shared across worktrees; `git log --all`). Every claim cites a SHA and, where load-bearing, file:line. Dates are commit dates.

## Headline finding

The reader's memory is directionally right but chronologically compressed. There is **no pre-July connector**: before 2026-07-17 the word "connector" appears only in `syntax-study.ts` (sentence-structure trees, unrelated — verified by `git grep -i connector` at d62a03a, 418a981, a884316). The whole visual history of word-run connectors is **13 days long (Jul 17–30)**, and it has five eras. The aesthetic peak — the thing the reader remembers as "the old build" — is the **C0.5 bracket grammar** (eda2d11, Jul 19) as productionized in the **Smart Shapes checkpoint** (64d0e5f, Jul 20). Phrase-STRING anchoring did break selection, but only in the lab era; it was fixed in the lab (76a572f) and production never used it — production has been occurrence-anchored from its first commit. What actually degraded the look later was not anchoring but the **Quire Rev 04 design ruling** (f202614, Jul 25), which stripped the washes, the companion tier, the focus veil, the per-kind hues, the draw-on animation, and the contact-dot bloom.

---

## Era 0 — Before connectors (2026-06-28 … 07-15)

- 037b59e / e3e730e / fcce2a3 (Jun 28–29): Devin-built M0–M2 engine + Electron shell; highlights and verse selection exist, no run-to-run connectors.
- 09fee39, 7a94754, d3cd48e (Jul 15, `codex/mobile-web-pwa` line): the "Connections" tab in the Living Margin is a **cross-reference list**, not drawn geometry (`docs/ui-audit/living-margin/paper-connections-margin.png` added at 09fee39 shows margin cards, not connectors). If the reader remembers connectors "much older" than the lab, this tab is the only candidate, and it drew nothing on the text.

**Anchoring in this era:** verse/quote selection preserved through translation changes by string quote (93f6205, 1362ff4) — the ancestor of the phrase-matching idea.

## Era 1 — The phrase-anchored lab: bows and ribbons (Jul 17–18, `codex/pattern-shapes`)

Born at **2384365** (Jul 17, "Pattern shapes visual lab: phrase-anchored mark language, three dialects"): a standalone `lab/shapes.html` + `lab/lab.js` + `lab/patterns.js`, deliberately outside the app.

**Geometry** (2384365 `lab/lab.js:145-183`): word-to-word cubic-bezier **bows** dipping into the margin —
`d = M sx y1 C sx+4 y1+dip, ex-4 y2+dip, ex y2` (same-line) and a deep gutter bow `C x1-bow y1+2 …` (cross-line); an orthogonal margin-lane variant already existed: `M x1 y1 H laneX+3 Q laneX y1 laneX y1+3 V y2-3 Q … H x2` (lab.js:177) — the seed of everything later. 12px transparent hit paths, hairline "legs".

Refinements in one day: 74242ca ("Connectors touch their marks"), then **34c3d5a** — connectors become **ink ribbons**: filled outline polygons around a sampled centerline, tapered ends, swell ~55–115% of nominal, "composed, not recorded"; **8b7f3f4** adds nib-tip draw-on choreography starting at the touched member; **44f8ab3** retires the mirror-S ("The S never survived contact with real spans — wobbly brackets at short range, a knee at long range, hockey-stick terminals").

**Anchoring — and where selection broke.** The lab anchored marks by **phrase string match** inside the verse. Breakage is on record: **76a572f** (Jul 18) "Anchor marks to the selected occurrence, not the first match" — "Selecting the second 'law' in PSA.1.2 now marks the second 'law'." Records gained an `occ` index ranked among the phrase's matches; render walked `indexOf` to the nth occurrence; dedup keyed on `ref+phrase+occ`. This is the reader's "phrase anchoring was breaking selection," and it is a *lab-era* defect, fixed the same day it was found. The same defect-class resurfaced in QA scripts months of commits later (4e04665, b63bbef, d3c59aa, Jul 25: string-anchor region slices picking the wrong occurrence — `.connection-card {` occurs twice; the fix was a helper asserting each anchor string occurs exactly once).

## Era 2 — Traces and the Loom route engine (Jul 18, same branch)

- **bd615af / 6a93741**: "Traces" toggle — cable-management orthogonal routing, **rounded-elbow cables at constant width**, lane allocation like a cable tray (shortest span nests innermost, overlaps step outward one pitch); kind signs ride the stroke (echo dashed, parallel twin wires, mirror midpoint tie, contrast mid-run gap).
- **3b2639a**: density discipline — only the focused pattern draws full weight; others are 32%-opacity ghost wires; adjacent-line pairs become tight "staples".
- **60d6efb**: the **Route Lab** — `lab/route-engine.js`, *pure geometry*: measured TextBlock + Annotation in, RoutePlan out; expanded obstacles (rendered lines, verse-number ink, headings), verified interline corridors, margin rail, same-line cradles, 4-lane budget, progressive disclosure. This engine is the direct ancestor of the production `src/core/annotations/route-engine.ts`.
- Routing-plan steps 2→13 (09f8c06 … eda43bf) harden it: word-run obstacles, local rails, held-tick hit targets + roving keyboard, **d97a22b** "Level exits: connectors continue straight from the underline when clear" — the first statement of colinearity — and **c57486d/439c603** port Shapes onto the Loom engine; 7ecea7b/6bd0959 add bidirectional margin routing and section handoffs.

## Era 3 — THE PEAK: the C0.5 bracket grammar (Jul 19–20)

**eda2d11** (Jul 19) "Land C0.5: the bracket grammar — calm terminals and handoffs." The commit message is the canon:

> "One drawn vocabulary remains: horizontals colinear with underlines, verticals, and one soft rounded right-angle corner. Every margin group is one level run straight off its underline (breaking at each dot) plus one soft corner at the rail; the route's bottommost group turns UP, all others turn down. Single-group routes end straight at the rail datum with no corner or drip. … The drop/shoulder family (offset-parallel lines below underlines) is removed. … Both lab hosts paint one clean uniform stroke; the swelling ribbon profile is retired."

This matches the user's approved-aesthetic memory file exactly (three prior geometry proposals — vertical-tangent pin turns, lead+settle sigmoids, below-line return loops — were each rejected at visual review as "weird angles", "not parallel", "looping weird").

Completing commits: **e355fbe** (carry the bracket into Shapes, one grammar), **fac162e** "Pin runs on the underline itself" — the run sits **exactly on the drawn 1.5px underline** via `UNDERLINE_STRIP = 2.25px` (the bottom strip of a measured box is where underlines legally live; "a run riding there IS the underline extended"), pins derived from the same ink-slack measurement as the fragments "so font metrics cancel and the pin lands on the underline's center exactly," ink-slack cache dropped on `fonts.ready`. **0345781** "One phrase, one mark" — washes become one merged silhouette per anchor (rounded only at true phrase ends and the wrap rag), underlines one continuous line per rendered line, verified 0.00px against bracket pin level at 1200 and 660px.

**Production landing: 64d0e5f** (Jul 20, `codex/smart-shapes` tip, "land Smart Shapes production checkpoint"). Introduces everything at once:
- `src/core/annotations/route-engine.ts` (2,658 lines) — the TS port of the loom engine, **unchanged to this day** (its only commit is 64d0e5f). Grammar constants at route-engine.ts:706-725: `CONTACT_LEAD 6` (min 3), `CORNER 6` ("the one shared rounded-corner token"), `UNDERLINE_STRIP 2.25`, `CLAIM_GAP 2.2`, `BAND_MIN 4.2`, `GAP_FACING_MIN 18`, `MAX_SECTION_STRANDS 3`. Comment at :727-730 records C0.5: "margins, locals, and cradles now use only colinear level runs and soft corners"; per-route corner radius capped `min(CORNER, runGap-1)` so adjacent corners never meet (:1857-1862); section handoff is corner → genuinely flat centered run → corner (:1579).
- `src/renderer/components/ConnectionUnderlay.tsx` (1,647 lines) — the production painter: two SVG underlays (emphasis/wash below text z-1, route layer above z-4), `planRoute` per connection, ink-tight rect measurement.
- `src/renderer/utils/connectionGeometry.ts` — the datum: `CONNECTION_UNDERLINE_HEIGHT = 1.5`, quiet/selected strokes 1 / 1.5px (underline) and 1.25 / 1.5px (route), `CONNECTION_UNDERLINE_LEVEL_GAP = 3`; canvas-measured font ink-slack (`measureText("Mahglpqy")`, connectionGeometry.ts:32-60) so the underline sits against glyph ink, not the line box.
- `scripts/qa-connection-paint.mjs` (1,047 lines) + `qa-connection-alignment.mjs`, `qa-connection-card.mjs` — real-Electron paint contracts.
- **Anchoring, from day one of production: occurrence-based, not phrase-string.** Same commit ships `src/core/annotations/backbone-token-anchor.ts` (translation-free canonical token layer `backbone-token:v1`, anchors = ordered sets of 1-based `{verse, position}` occurrences; "Discontinuous selections are sets of ordered occurrences rather than a range that could capture unrelated words," backbone-token-anchor.ts:36-43), `occurrence-alignment.ts` (SHA-bound per-package char_start/char_end fragments per occurrence), `data/scripture/backbone-token-v1.jsonl` and the BSB alignment package.

**What the peak looked like** (64d0e5f `styles.css:1529-1667`): per-kind ink (`.connection-kind-parallel { --connection-ink: var(--mark-parallel) }` etc., six kinds); dormant wash `fill-opacity .09` (dark: .045 glyph overprint "so the reading page doesn't turn into fields"); paint-state ladder companion .05 / preview .12 / selected .16; shared-word **gold band via mask knockout**; **focus veil** at .56 opacity with a luminance-mask hole around the attended connection; underline quiet 1px @ .62 opacity → focused 1.5px @ .96; route drawn on via `stroke-dashoffset` 340ms `cubic-bezier(.22,.72,.2,1)`; contact dots scale .72→1 with 90ms-delayed bloom; companion tier at thinner stroke; gutter ticks that widen 11→15px on focus.

## Era 4 — Pericope hardening (Jul 21–22, `codex/pericope-integration`)

3104d1f (Pericope identity), 67d44dc, 2b48dc7 ("harden Pericope reading interactions"), **db3ffd9** "harden desktop reading precision" — adds `src/core/annotations/connection-order.ts` and 33 lines to occurrence-alignment, plus `scripts/qa-desktop-reading-control.mjs`. Geometry untouched; anchoring machinery deepened. During this window a transitional `selection_shape` sidecar (phrase-shape metadata: content/own occurrences, lead/trail function-word counts) was written on format_version=2 anchors and then abandoned **without a migration** — 64 anchors in the owner's real library later refused to boot (`validateBackboneTokenAnchor`'s closed ANCHOR_KEYS), fixed by enumerated read-time stripping in **ce02c2d** (Jul 26; see `src/core/annotations/retired-anchor-fields.ts:27-40`). This is the *production* incident nearest to "phrase work breaking things": it broke **boot**, not landing precision.

Occurrence alignments then scaled to three more translations: **d3712ab** "ship WEB/KJV/YLT occurrence alignments with freshness and conformance gates" (Jul 25, pericope-integration).

## Era 5 — Quire Rev 04: connections replaced (Jul 25 → today, `codex/quire-redesign`)

**f202614** (Jul 25) "Rev 04 — laurel, two new laws, and connections replaced": design studies D·2/D·2b withdrawn. The ruling (commit message + current `styles.css:4607-4790`):
- At rest a member is a **1.5px underline in ink-faint (#C8C2B8)**; attending re-inks it to seal **at the same weight** — "attention changes colour and nothing else." Stroke never thickens, never moves off the fixed centre datum (`connectionGeometry.ts:3-5`).
- **Underlines never stack** — one flattened stroke cut at membership boundaries, `stroke-linecap: butt` so runs abut (styles.css:4684-4704); counts move to the gutter tick stack (three ticks then +n).
- **Exactly one route is ever drawn** (the focused one); the companion tier deleted.
- **The focus veil deleted at source** ("selecting a connection washed the entire chapter, scripture included, to make a 1px rule easier to find" — styles.css:4636-4652).
- **The wash is gone** from dormant/companion/preview/selected/needs-space (Law 5: "a wash says this text is marked, a rule says this text is connected to that text — a relation may not wash"); only live authoring/selection washes survive.
- **Per-kind hue gone**: "the kind is carried by the word and by nothing else" — one small-caps word at the spine's head (`.connection-route-kind`, styles.css:4725-4736); draw-on animation gone ("The route never traces along its own path"), contact-dot scale bloom gone, everything on a single 140ms attend fade.
- 83762f8 makes the Connections tab list real connections; 38c6d7e gates card mutations behind authored drafts; 0cfafdd/4fcd180/db28b8b keep tuning quiet ink and QA. The route **path geometry** still comes from the untouched C0.5 route-engine; ConnectionUnderlay lost 477 lines (veil, companion planning, quiet-stroke plumbing) between 64d0e5f and HEAD.

So Rev 04 kept the bracket's bones and removed its atmosphere. What the reader misses is Era 3's *paint*, not different *paths*.

---

## Judgment: the peak, and how to revive it

**Peak = 64d0e5f (Jul 20), the production form of eda2d11's C0.5 grammar, with fac162e's on-the-underline pinning.** It is the only moment that had, simultaneously: the approved bracket vocabulary; landings verified to 0.00px on the underline datum; the full attention atmosphere (washes, companion tier, veil, per-kind ink, draw-on, contact bloom); and occurrence-precise anchoring.

**Revival kit (exact sources):**
- Grammar/paths: `src/core/annotations/route-engine.ts` — already in HEAD, byte-identical to 64d0e5f. Nothing to restore; do not touch `CORNER`, `UNDERLINE_STRIP`, or the C0.5 comments.
- Datum: `src/renderer/utils/connectionGeometry.ts` (HEAD) — keep the fixed 1.5px centre datum and ink-slack measurement.
- Peak paint: `git show 64d0e5f:src/renderer/styles.css` lines 1500–1720 (kind hues, wash ladder .045/.05/.09/.12/.16, gold shared-word mask, veil .56/.52, stroke ladder 1/1.25 → 1.5, dashoffset draw-on 340ms `cubic-bezier(.22,.72,.2,1)`, contact bloom .72→1).
- Peak painter behavior: `git show 64d0e5f:src/renderer/components/ConnectionUnderlay.tsx` (companion claim ranking, veil mask, preview state).
- Visual proof surface the user actually approves from: `lab/c05-fixtures.html` (present since eda2d11) — geometry changes must be shown as screenshots before being frozen into digests; digests passing ≠ visual approval.
- Contracts that pin geometry: `tests/annotation-route-engine.test.ts`, `route-engine-claims/sections/bidirectional.test.ts`, `pattern-shapes-geometry.test.ts`, `route-lab-digest-contract.test.ts`, and `scripts/qa-connection-paint.mjs` (dormant/focused/companion/release/merged-anchor/overflow/reduced-motion states — note its header still names "two-held companion paint," an Era-3 concept Rev 04 deleted; the script was retuned at db28b8b/0cfafdd).

**Feed it with the CURRENT anchoring — do not resurrect anything older.** The live machinery is exactly right for the old look: `backbone-token-anchor.ts` (canonical `{verse, position}` occurrence sets) + `occurrence-alignment.ts` (SHA-bound char ranges per package) now covering BSB (64d0e5f) + WEB/KJV/YLT (d3712ab). The peak painter already consumed this pipeline, so re-applying Era-3 paint on today's anchors is a CSS/ConnectionUnderlay restoration, not an anchoring change.

**What the old code did that current contracts now forbid (revival must negotiate, not copy):**
1. The **focus veil** — Rev 04 rules it a plane violation ("Every other member stays ink-faint and does not dim"). Reviving it verbatim contradicts a designer ruling recorded at f202614 and styles.css:4636-4652.
2. **Washes on durable relation states** — Law 5 explicitly forbids a relation washing; only marking-selection/authoring washes are contractually alive (marking-surfaces contract, `tests/marking-surfaces-contract.test.ts`).
3. **Per-kind hue on the route layer** — Rev 04: the kind is one word, "never colour-coded."
4. **Draw-on animation and stroke thickening under attention** — Rev 04 §5: 140ms fade only; "the route never traces along its own path"; stroke changes symmetrically about the datum or not at all.
5. **Stacked/offset parallel underlines for overlapping memberships** — now forbidden; one flattened butt-capped stroke plus gutter ticks.
6. `selection_shape` or any new anchor sidecar — ANCHOR_KEYS is deliberately closed; retired fields are read-time-stripped by enumeration only (`retired-anchor-fields.ts`).
7. Lab-era phrase-string `indexOf` matching (2384365, pre-76a572f) — the thing that actually broke selection; the backbone-token contract exists specifically to make it impossible.

**Transition summary (why each change happened):** bows → ribbons (34c3d5a: hand-ink feel) → traces (6a93741: density collisions seen in screenshots) → loom engine (60d6efb: obstacles and corridors from first principles) → bracket grammar (eda2d11: three ornament families rejected at visual review; calm colinear vocabulary approved) → production (64d0e5f) → Rev 04 reduction (f202614: designer withdrew the studies; washes/veil/hues ruled violations of Law 5, the plane model, and reserve).

---

## Era 6 — Settling: the Old Testament becomes authorable (2026-07-31)

**The complaint.** "the old testament is still not allowing connections only the new; we were supposed to remove the complex phrase / original language; and use just the english…. why cant we do connections in ot?"

**The mechanism, measured live before the fix.** `backbone-token:v1` is the
ORIGINAL-LANGUAGE word layer — `data/scripture/backbone-token-v1.jsonl` carries
`"language": "Hebrew"` tokens for the Old Testament and `"language": "Greek"`
for the New. A Hebrew word carries its preposition, article, conjunction and
pronominal suffix inside itself, and the publishers' own alignment tables say
so: BSB's row for GEN 1:1 is `{"word":"In the beginning","strongs":["H7225"]}`
— three English words, one canonical token, so all three lexical fragments in
`data/scripture/packages/bsb/occurrence-alignments-v1.jsonl` carry occurrence
position 1.

Authoring then ran the marked words through
`captureOccurrenceAlignedSelection` → `projectBackboneTokenAnchor` →
`selectionProjectionRoundTrips` (`src/electron/main.ts`), and that last gate
demanded the reprojection reproduce the marked words EXACTLY. Marking
"beginning" anchored Hebrew token 1, which reprojects as "In the beginning",
which is not "beginning" — refused, with "This translation cannot preserve
those exact words yet."

Single-word admission, measured against the real packages by driving the app
(GEN 1, DEU 32, PSA 23, ISA 53 vs JHN 1, ROM 8, all four installed
translations):

| | BSB | WEB | KJV | YLT |
| --- | --- | --- | --- | --- |
| Old Testament | 10–16% | 13–19% | 9–13% | 16–21% |
| New Testament | 47–58% | 38–59% | 40–61% | 44–65% |

The artifact was never the problem — the occurrence-alignment index and the
backbone token catalog both carry all 31,102 verses across all 66 books. The
GATE was the problem, and the asymmetry it produced is exactly the difference
between Hebrew and Greek word shape.

**The change.** `selectionSettlesIntoProjection`
(`src/core/annotations/occurrence-alignment.ts`) replaces equality with
containment: the reprojection must CONTAIN every marked word, in order. A
wider reprojection is the canonical unit settling around the reader's words,
and the host returns those settled words (`settled`, transport-only) so the
surface holds and shows what the anchor holds. A reprojection that DROPS or
REORDERS a marked word is still an artifact defect and is still refused. After
the change, single-word admission is 82–100% everywhere, and the Old
Testament no longer differs from the New.

**No persisted format moved.** `ANCHOR_KEYS` is untouched, `OCCURRENCE_KEYS` is
untouched, `backbone-token:v1` is untouched, and every anchor written before
today still validates and projects byte-identically. The settled fragments are
package-local render evidence on the IPC reply only; nothing new reaches an
event payload, so `retired-anchor-fields.ts` gains no entry.

**What this costs, said plainly.** Marking one English word inside a Hebrew
word holds the whole Hebrew word's English span — "beginning" in Genesis 1:1
holds "In the beginning"; "shepherd" in Psalm 23:1 holds "is my shepherd". The
reader sees that span held before saving and on the card afterwards. Going
finer than the original-language word is not a gate we can relax: below that
token there is no coordinate two translations share, so English-word precision
and cross-translation projection are mathematically exclusive. Buying the
finer unit would mean a versioned anchor format that is package-scoped — a
decision nobody has made, and one that must be made out loud if it ever is.

**Still refused, honestly.** A lexical fragment the package's own table left
unaligned has no canonical occurrence, so marking it alone still refuses with
`display-only-selection` (visible mostly in YLT). Punctuation alone still
refuses with `zero-canonical-occurrences`; a part-word still refuses with
`partial-word-selection`. Those refusals name real absences rather than
Hebrew.

**Contracts restated on this date** (each carries the quoted old claim in
place): `tests/desktop-reading-control.test.ts` ("active-package connection
capture refuses lexical widening"), `tests/marking-surfaces-contract.test.ts`
(the draft paints `current.paintAnchors`), and
`scripts/qa-desktop-reading-control.mjs` (the ACT 19:2 "Holy Spirit" widening
must be refused, and the palette must print "This translation cannot preserve
those exact words yet").

**Proof.** `docs/ui-audit/connections/ot-authoring/` — eleven connections
authored with the real marking gesture and saved through the palette in
Genesis 1, Deuteronomy 32, Psalm 23, Isaiah 53, John 1 and Romans 8 across
BSB, WEB, KJV and YLT; each reloaded from the durable log and painted, ten of
the eleven drawing a route and the eleventh honestly reporting needs-space.
