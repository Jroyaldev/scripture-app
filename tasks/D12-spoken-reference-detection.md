# TASK D12: Finding the passage in the transcript

STATUS: OPEN — researched 2026-07-28, measured against the real corpus, unbuilt.

## Objective

Turn "this episode discusses Exodus 20:17" into "at 23:14 they discuss Exodus
20:17", by detecting spoken scripture references in the 528 machine transcripts
and anchoring them to canonical brefs.

## The constraint that decides every other choice

**A false reference destroys trust faster than a true one earns it.** A reader
who clicks an anchor and hears something unrelated stops believing the feature —
including the anchors that were right. Missed references are invisible; wrong
ones are discovered at the exact moment someone decided to trust us.

Target: near-zero false positives at whatever recall that costs. 40% coverage
that is always right beats 90% that is wrong one time in twenty.

## What measurement changed

Every claim below was checked against our own transcripts rather than taken from
the literature. Four of the working assumptions were wrong.

**Capitalization survives, and it is the cheapest strong signal we have.**
Parakeet emits cased, punctuated text, and the casing tracks the book/word
distinction almost perfectly: `Genesis` 5,107 vs `genesis` 11; `Job` 671 vs
`job` 508; `Kings` 294 vs `kings` 833; `Song` 161 vs `song` 374. The premise
that spoken transcripts have no reliable capitalization was false for ours.

**The dangerous failure is not a match on nothing — it is a confident wrong
book.** The leading maintained parser silently resolves `two Timothy` to
**1 Timothy**, `three John` to the **Gospel of John**, and `two Kings` to
**1 Kings**. No error is raised. Cardinal number words are not in its prefix
vocabulary, so they are discarded and the bare book name falls back to the first
of the series. Ordinal words (`First John`, `Second Samuel`) parse correctly;
cardinals do not. Our corpus contains 23 such spoken cardinals, and the parser
produced **zero** 2 John / 3 John detections across all 528 episodes.
Normalising `one|two|three|four` + book to the ordinal form before parsing is
mandatory, not a refinement.

**`So verse N` is the most instructive false positive in the corpus.** These
speakers open clauses with "So" constantly, and "So verse 13" is their ordinary
way of advancing through a passage. A naive parse reads `So` as Song of Solomon
and emits `Song.1.13` — well-formed, confident, and wrong at exactly the moment
a real reference is being made. In one case the correct answer (`1Sam.18.9`) was
named fifteen words earlier. Lowercase-led detections are 1.76% of all matches
and are close to 100% false; that single filter is decisive.

**Publisher brefs are a recall-incomplete highlight list, not ground truth.**
92.4% of detections had their book in the episode's bref set. The 7.6% outside
it, inspected by hand, are overwhelmingly *correct references the publisher
simply did not tag* — Genesis 22, Psalm 75, Daniel 7, Isaiah 61 and others.
Using brefs as a hard filter would delete true positives at a meaningful rate.

## Verse quotation: strong corroborator, weak locator

Matching spoken words against known scripture text separates true from random
verses almost perfectly — at a 0.7 content-word threshold, 16.5% of tagged
verses match against a 0.1% false-positive rate on random ones.

But it cannot tell you *which* verse. Of 56 verses plainly read aloud, the true
verse was the unique best match within its own chapter only **64%** of the time;
a neighbouring verse tied or won 37.5% of the time, because reading a passage
puts adjacent verses in the same window. Offsets of the winning wrong verse ran
from −16 to +6.

Two consequences:

- Quotation evidence alone justifies a **chapter**, never a verse. When only a
  quotation matched, say "Exodus 20" and stop. Never invent the verse number.
- Verse resolution needs monotone local alignment (Smith-Waterman over the word
  stream against the chapter text), not bag-of-words windowing. That also yields
  a start and end *time* for the reading rather than a point, which our 80ms
  word timestamps support directly.

Recall is genuinely low because this podcast *discusses* far more than it
*reads*, and when it reads it often uses the host's own rendering from Hebrew or
Greek. That is a fact about the corpus, not a fixable deficiency.

## Bare "verse N", measured

967 mentions across 528 episodes with no book name nearby. Distance back to the
last book mention: median 112 words, p75 336, p90 714.

| Window | Coverage | Two or more books in scope |
|---|---|---|
| 50 words | 31.0% | **3.7%** |
| 100 words | 36.5% | 10.8% |
| 200 words | 41.0% | **22.4%** |

Carry context ~50 words, and only when exactly one book is in scope. Better
still: extend until a *second distinct book* appears, then stop. Widening to 200
words buys 10 points of coverage for six times the contention — a bad trade
under a precision-first objective.

## Proposed tiers

| Tier | Evidence | Shown as |
|---|---|---|
| **A** | Capitalized book (≥4 chars, not sentence-initial homograph) + explicit chapter *and* verse keyword; **or** alignment coverage ≥0.8 | Verse deep-link |
| **B** | Capitalized book + chapter, no verse; or verse evidence that failed within-chapter disambiguation | **Chapter only** |
| **C** | Bare "verse N" resolved by ≤50-word single-book context; prior-supported only; short abbreviations | Stored, not displayed |
| **D** | Lowercase-led; book surface ≤3 chars; sentence-initial homograph; unresolved cardinal-ordinal; contraction fragments (`you're 12` → `Rev.12`) | Discarded |

If the best available evidence is tier C, show nothing. A blank margin costs one
feature impression; a wrong `Song 1:14` costs the reader's belief in all of it.

**Show the evidence with the anchor.** Rendering the transcript snippet that
produced a reference lets a reader self-correct, which converts a
trust-destroying error into a visible and forgivable one. A "wrong verse"
control on each anchor is also the cheapest labelling pipeline available.

## The recall nobody is counting

Named episodes — the golden calf, the burning bush, the road to Emmaus, the
sermon on the mount — are frequent here, unambiguous, and invisible to every
reference parser, because they contain no numbers. A curated gazetteer of a few
hundred named pericopes mapped to passage ranges is high precision by
construction (the phrases are long and distinctive) and probably a better first
shipping feature than verse-level parsing.

## Other findings worth keeping

- **The chapter-verse separator in speech is a bare space**, so every "Book N M"
  parses as chapter:verse. This is the single largest false-positive amplifier
  for spoken text; require an explicit "chapter"/"verse" keyword instead.
- **Translation fingerprinting works coarsely and fails finely.** Archaic vs
  modern separates reliably; two modern translations tie ~31% of the time on a
  single verse. A fifth outcome is needed — *the speaker's own rendering* —
  because labelling a live translation from Hebrew as "WEB" would be a false
  claim. Do not surface translation attribution to readers; use it only to pick
  which text to display.
- **Anchors may want to be spans, not points.** One "Genesis 22" can govern
  eight minutes of conversation. A span that starts thirty seconds early is
  forgivable in a way a wrong verse is not.
- **Prosody is a free independent signal.** Read speech and spontaneous speech
  differ measurably, and inter-word interval variance is computable from the
  timestamps we already have, with no audio reprocessing. Reference + quotation
  + reading prosody is close to certain.
- **The real product is the inverse index**: not "what does this episode cite"
  but "I am reading Exodus 20 — who has taught on this, and where". Ranked by
  dwell time rather than mention count, which makes low recall survivable: only
  the strongest anchor per passage is needed, not all of them.
- **An LLM may verify, never detect.** Given a ±40-word window and a candidate,
  asking only yes/no/unclear — with *unclear* mapping to discard — is the
  citation-grounding pattern. Unconstrained generation of references is exactly
  the hallucination surface to avoid.

## Tooling

`openbibleinfo/Bible-Passage-Reference-Parser` (MIT, actively maintained) is the
only serious option and already handles ordinal book words, `chapter`/`verse`
keywords, and range words. It does **not** handle spelled-out numerals, and our
corpus uses number words about twice as often as digits (38,697 vs 19,394), so
numeral normalisation is required pre-processing.

Its own documentation warns it is aggressive and will produce false positives on
raw text — the documented example being `she is 2 cool` → `Isa.2`, which
reproduces. Configure `case_sensitive: "books"`, `book_alone_strategy:
"ignore"`, `passage_existence_strategy: "bcv"`, `captive_end_digits_strategy:
"delete"`, and override the weak chapter-verse separator rule.

## Verification

- Build the labelled set from disagreements: the ~730 detections outside the
  bref set, plus brefs with no detection, are a pre-sorted high-yield queue of a
  few hundred items. That yields a real precision number instead of agreement
  with an incomplete gold set.
- Hold out episodes whose brefs are never used, and report precision separately
  on prior-supported and prior-unsupported detections. If the latter collapses,
  the prior is carrying the model.
- Regression check: for every book in an episode's bref set, does the detector
  ever fire on that book? That check is what surfaced the cardinal-ordinal bug.

## Caveats carried from the research

Sample sizes were 56–172 verses for the quotation and fingerprinting work —
indicative, not final. The 92.4% figure is agreement with an incomplete gold
set, not precision. Negative controls used random verses; the hard negatives
(adjacent verses, synoptic parallels, OT quotations inside NT books) remain
unmeasured. No biblical-domain ASR error study exists for any model, so
Parakeet's behaviour on biblical proper nouns is unquantified.
