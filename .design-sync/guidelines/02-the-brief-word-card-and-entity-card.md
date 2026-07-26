# The brief — two surfaces, and the overload problem

Design **the word card** and **the entity card** inside the Living Margin.

The panel is **380 px wide**. Read `01-data-shape-old-vs-new.md` first: it says what
data now exists. This document says what to do about the fact that there is far too
much of it to show at once.

---

## 1. The actual problem is not "show the new data"

For a single Greek word the app now holds **four** definition sources — Mounce, TBESG,
TFLSJ, SDGNT — on top of the two it already had (Strong's, Thayer). For a single person
it holds **four** — TIPNR, translationWords, Hitchcock, ISBE.

Stacking them produces four paraphrases of the same sentence. A reader who sees
*"chief priest, high priest"*, then *"a high-priest, chief-priest"*, then a 53-word
Abbott-Smith article, then a 2,480-character LSJ entry, has not learned four things.
They have read the same thing four times and given up.

**So the design job is subtraction under constraint, not addition.** Two rules follow.

### Rule 1 — one job per source, and silence everywhere else

Redundancy disappears when no source is asked to do a job another source already does.
Give each one the slot where it is *uniquely best*:

| slot | source | why it and not another |
|---|---|---|
| the 25-word gloss | **Mounce** where it fits, **TBESG** otherwise | modern and concise; the importer already picks a winner per word (Mounce 4,383 · TBESG 6,773 · 1 missing) |
| what kind of thing this word is | **semantic domain** (SDBH/SDGNT) | says *"Roles and Functions"* — a category, which no gloss gives |
| the deep read | **TFLSJ** | article-length, opened deliberately, never by default |
| grammar | TEGMC | already at parity and already good — **do not redesign it** |

Same shape for a person: Hitchcock gives the name's meaning and nothing else; TIPNR
gives identity, genealogy and references as **structure, not prose**; translationWords
gives the orienting paragraph; ISBE is the deep read, labelled **1915**.

### Rule 2 — depth is a ladder the reader climbs, not a pile they are handed

One line → one paragraph → one article. Nothing below the reader's current rung is
drawn. The panel's resting state should be readable in about three seconds.

---

## 2. What "without overload" concretely means here

- **Rest shows at most one prose block.** Everything else is a mark, a count, or a label.
- **Agreement is noise; disagreement is content.** If two sources say the same thing,
  show one. If they *differ*, that difference is the interesting part and deserves a mark.
- **Empty slots collapse.** Never draw a labelled container with nothing in it. Several
  sources have real coverage holes (*kurios* has no domain today).
- **A count can replace a list.** "19 people share this name" beats nineteen rows, and
  it is also the more honest statement.
- **Never invent a summary across sources.** A blended paragraph is attributable to
  nobody, which breaks the provenance rule below — and for the 124 colliding names it
  would produce a confident, wrong biography.

---

## 3. Provenance is not decoration — it is the design language

Every claim on screen is marked by *who said it*:

- **seal** — the reader wrote it
- **slate** — the app inferred it
- **laurel** — a named, licensed third party said it (the only clickable mark)
- **unmarked** — it is the edition itself

Consequences a design must respect:

1. **A source is named per claim, never per panel.** Within one word card, different
   lines legitimately carry different sources — even within TBESG, a single
   "Abbott-Smith" label would misattribute 5,327 of 11,035 rows.
2. **Dates are part of the mark where a source has one.** "ISBE, 1915" tells a reader how
   to weight a claim. This is a feature, not an apology for using old scholarship.
3. **Two sources may never be merged into one field.** Enforced in code, not just style.

---

## 4. The two surfaces

### The word card — `LanguageWordsSection`

Today: the printed form, lemma, Strong's, transliteration, pronunciation, one
morphology line, a gloss, a sense orbit (`RenderingOrbitView`), and counts.

Needs to gain, without getting longer: the semantic domain; the plain-English `role`;
the "used here" sense; the `rare` mark; a way into the deep lexicon; and Hebrew
transliteration on the 43% of cards that currently lack it.

Consider what leaves. Two lexicon entries stacked is the redundancy this brief exists
to remove.

### The entity card — inside `LivingMargin`

Today: the name, kind, a one-line identity, references.

Needs to gain: the name's meaning (one line); an orienting paragraph **only where the
entry is about this individual**; the ISBE article as a deliberate deep read; and, for
places, the geography already shipped. Where a name covers many people, saying so *is*
the useful content.

---

## 5. Material and fit

- **Two planes only: paper and canvas.** No third fill. Hover and selection are marks or
  ink changes, never a new background colour.
- **Mark, don't fill.** A rule, a siglum, an underline — not a coloured block.
- **The panel is 380 px.** Long Greek and Hebrew strings, RTL Hebrew, and 2,480-character
  lexicon prose all have to live in it.
- **Photographs are a foreign material** in an ink-on-paper language. Flora/fauna plates
  are not shipped yet; if a design anticipates them, decide deliberately whether an image
  sits on the canvas rather than the paper, and expect it to be the only photographic
  thing on screen.
- **Motion:** one 180 ms exchange, on the existing token. Nothing moves on hover.
