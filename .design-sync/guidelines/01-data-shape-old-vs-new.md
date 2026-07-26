# Data shape — what changed, and what is now available

Pericope is an offline Bible-study app. Its study panel is the **Living Margin**.
This document says what data the margin could draw **before** 2026-07-26 and what it
can draw **now**, because the gap between those two is the entire reason this design
project exists.

Every number here was measured against the shipped data, not estimated.

---

## 1. The short version

**Before:** one gloss, one morphology line, one lexicon entry, a frequency count, and
a one-line identity for people and places.

**Now:** four Greek definition sources, a full classical lexicon, a semantic-domain
model that spans both testaments, three prose sources for people, a flora/fauna/realia
corpus anchored to individual words, and a scholarly parallel-passage corpus.

The app acquired roughly 140 MB of new data in a single day. **Almost none of it has
a surface.** The design problem is not "find more data". It is *"this much data now
exists and the panel is 380 px wide."*

---

## 2. What the word card had, and has

| | before | now |
|---|---|---|
| Surface form (the printed word) | yes | yes |
| Lemma, Strong's, transliteration | yes | yes (Hebrew translit exists for 8,674/8,674 keys but reaches the card **57%** of the time) |
| Morphology in plain words | yes | yes — unchanged, and already good |
| Short definition | Strong's first sense only | **Mounce** (1993, modern, concise) + **TBESG** (Abbott-Smith 1922) — 11,157 keys |
| Full lexicon entry | Strong's + Thayer (Greek) / BDB (Hebrew) | unchanged, plus **TFLSJ** (full Liddell-Scott-Jones): 11,034 entries, mean 2,480 chars, 121,856 citations kept separate from the definition text |
| Semantic domain | Louw-Nida on Greek tokens, **never printed** | **SDGNT** 5,507 entries / 7,075 Louw-Nida codes and **SDBH** 7,932 entries / 16,224 meanings — the same Louw-Nida scheme, verified, so one domain model now spans both testaments |
| Frequency | chapter / book / corpus | unchanged (and "corpus" currently mislabels one testament) |
| Sense inventory | frequency-ranked renderings | unchanged |
| Related words / compounds | none | still none — the source that drives this in STEP is unpublished |

### The precision problem the card still has

Strong's numbers merge senses that the newer sources keep apart. STEP writes `G4245G`
("elder", the office) and `G4245H` ("elder", meaning old); the card shows plain `G4245`,
whose gloss reads *"elder (-est), old"* — both at once, undecided.

It is not cosmetic. The card reports that the word behind *"In the beginning God
created"* occurs **54** times. Fifty-three are *bara*, "create". The fifty-fourth is a
homonym in 1 Samuel 2:29 about Eli's sons fattening themselves.

Whole-lexicon: **109 Greek** and **1,391 Hebrew** bases split this way. `H3027` (*yad*,
"hand") and `H5375` (*nasa*, "lift") carry **18 senses each**.

---

## 3. What the entity card had, and has

**Before:** TIPNR only — 4,259 individuated people and places (3,132 persons, 1,013
places), each with genealogy, an exhaustive reference list, and a one-line identity.

**Now, three prose sources on top:**

| source | records | what it is | granularity |
|---|---|---|---|
| unfoldingWord translationWords | 368 | modern, human-written, 4-sentence orientation | **name-level** |
| Hitchcock's Bible Names | 2,625 | name etymology, one line | **name-level** |
| ISBE (1915) | 4,657 records, **1,265 distinct persons bound** | article-length scholarship | **person-level** |

### The granularity trap — the most important thing on this page

**TIPNR is person-level. translationWords is name-level.** They do not line up.

Of the 355 translationWords name entries, ~306 match a TIPNR name — but those matches
hit **685 distinct TIPNR entities**, and **124 entries map to more than one person**:

- `azariah` → **19** different people
- `shimei` → 16 · `hananiah` → 15 · `joel` → 14 · `benaiah` / `jonathan` / `obadiah` → 12 each

So a naive join attaches one paragraph to nineteen different Azariahs and is wrong
about eighteen of them. The importer already resolves this — **195 person-scoped, 173
name-scoped** — and a contract test fails if a name-scoped entry is ever presented as
an individual's biography.

**A design must honour that split.** An entry that covers many people is about *the
name* and must be labelled so. Only ISBE resolves *which* Azariah.

---

## 4. Data that is new to the margin entirely

**Flora / fauna / realia** — 762 entries, 22,244 Scripture references, 19,786 anchors,
754 plate records. Each entry links to Hebrew/Greek **lemmas** and then to **word-level**
references, which is the same resolution the app's own connection anchors use. So a
plant or animal can attach to a word, not merely to a verse.

*No images are shipped.* The three archives total 2.4 GB, and copyright is per plate —
only 104 of 754 credit UBS, so a blanket credit would misattribute 650 of them. Treat
plates as **not yet available**; design the entry so it reads well without one.

**Parallel passages** — 2,193 groups, 5,266 members, 31.3% net new against the existing
cross-references. Must stay a separate dataset from the CC BY cross-references (licence),
so in the UI it is a distinct, separately-attributed block, never merged into one list.

---

## 5. Dark data — already computed, already discarded

These need **no new data and no engineering**. They exist and nothing draws them:

- **MACULA `role`** — on 46,782 Greek tokens, **zero render sites**
- **Louw-Nida ids** — reach the renderer's types, never printed
- **`rare` / `repeat` marks and word neighbourhood** — computed on *every* card call and thrown away
- **Hebrew transliteration** — present for every key, shown 57% of the time
- **"Used here" sense** — the token knows which sense is in play; the card shows the ambiguous one

For Acts 24:1 *presbuterōn*, the card prints Strong's undecided *"elder (-est), old"*
while the same token already carries Louw-Nida `53.77`, "elder", which agrees with the
newer sources. **The right answer is in hand and the ambiguous one is on screen.**

---

## 6. Known-wrong data — do not design around it as if it were true

- **Hebrew verse alignment is broken in 137 of 929 chapters.** The Hebrew package uses Hebrew
  versification and the reader's English verse is passed straight through. On English Psalm 3:1
  the card serves the psalm's *superscription*, not the verse on screen. Also affects 323
  parallel-passage references and 144 flora/fauna references.
- **SDGNT has a 635-occurrence parse defect** — 620 of them on *kurios*, which yields an
  **empty domain panel** on one of the most common words in the New Testament.
- **Frequency says "in the corpus"** when it means one testament.

A design may assume these get fixed. It must not assume they are fixed *now* — an empty
state for the domain block is a real state, not a hypothetical.
