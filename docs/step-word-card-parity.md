# STEP word analysis vs our word card — parity, data shape, and the costed plan

Status: measured against STEP 26.1.2 running locally on `:8989`, and against this
worktree (branch `codex/quire-redesign`), 2026-07. Every "we show" claim cites the file it
was checked in. Every dataset size below was confirmed by `stat` on disk or by
`content-length` on the upstream host; sizes taken on trust are labelled.

Written for two readers. The **designer** laying out the card needs §1, §2 and the field
meanings in §3. The **engineer** populating it needs §3, §4 and §5.

Companion docs:
[`docs/original-language-data-sources.md`](./original-language-data-sources.md) (see §5 — its
licence guidance is **stale**), [`docs/language-margin-history.md`](./language-margin-history.md).

---

## 1. What STEP shows for one word

Worked case: **ἀρχιερεύς**, `G0749`, as it appears in Acts 24:1 ("the high priest Ananias").
STEP's sidebar stacks six blocks for that word, and they come from six different places.
The **head** is `matchingForm` + `stepTransliteration` + the padded Strong's number
(`ἀρχιερεύς / archiereus / G0749`) — note this is the **lemma**, not the inflected
ἀρχιερεὺς the reader is looking at; the surface form exists only in the rendered HTML, never
in the word-card payload. **"Meaning"** is one field, `mediumDef`, whose two lines are a
single string split by an embedded `<br />`: `"chief priest, high priest <br /><b>a
high-priest, chief-priest</b>"` — sourced from Mounce for the NT and abridged BDB for the OT,
and **not published in STEPBible's CC BY repo** (§4 step 8). **"LSJ dictionary"** is
`lsjDefs`, 1,070 characters of formatted Liddell-Scott-Jones 9th ed. with the citation
bibliography hidden in `<a title="…">` tooltips — this one *is* published, as TFLSJ.
**"Related words"** is `relatedNos`, resolved from `rawRelatedNumbers: "G0746, G2409"` into
ἀρχή (beginning) + ἱερεύς (priest) — the compound decomposition, sourced from
`@StepRelatedNos2`, which is **not** in the published repo. **"Grammar"** is
Function/Case/Number/Gender rows plus an `i.e.` meaning line and an `e.g.` example line, from
TEGMC/TEHMC — the two files we already ship byte-identically. **Frequency** is
`counts: {book: 22, bible: 122}`, two scopes only. All of it is keyed on the
*sense-disambiguated* Strong's tag, which for this word is plain `G0749` but for its
neighbour πρεσβυτέρων in the same verse is `G4245G`, with `_detailLexicalTag G4245H`
pointing at the sense STEP kept separate — and that key choice is the one thing in this
document that changes an answer rather than a layout (§4 step 0).

Verified live: `curl -s "http://localhost:8989/rest/module/getInfo/ESV/Acts.24.1/G0749/N-NSM/en"`.
The `lsjDefs` string returned is byte-identical to TFLSJ line 3013 column 8.

---

## 2. Field-by-field comparison

Verdicts: **PARITY** — we match or beat STEP today. **HAVE-BUT-HIDDEN** — the data is in
our pipeline and reaches the renderer, but no render site draws it on the word card.
**NEED-DATA** — requires a dataset we do not ship. **N/A** — out of scope or deliberately
not copied.

| # | field | STEP shows | we show | our source | verdict |
|---|---|---|---|---|---|
| 1 | **Inflected surface form** | No — `matchingForm` is the **lemma**. Acts 24:1 reads ἀρχιερεὺς; STEP's card says `ἀρχιερεύς`. The surface only exists in the rendered HTML, not the word card | Yes, the printed form, RTL/LTR-correct | `LanguageWordsSection.tsx:1262-1269`; `token-package-loader.ts:842-844` strips OSHB `/` | **PARITY** (we are ahead — see verdict A) |
| 2 | **Lemma / dictionary form** | Yes (`matchingForm`) | Yes, in the strip and the orbit; `lemma` on every token | `macula-greek-tsv.ts:230`; token field `lemma` | PARITY |
| 3 | **Transliteration — Greek** | `stepTransliteration`, 100% | Yes, 97% of Greek Strong's | `LanguageWordsSection.tsx:1270-1272` ← `definition.xlit`; strongs-plus G-side **5,363/5,523 = 97%** | PARITY |
| 4 | **Transliteration — Hebrew** | 100%, syllable-dotted (`e.lo.him`) | **No, 57% of the time.** The card reads only `definition.xlit`; strongs-plus H-side is 4,924/8,674 | `strongs-hebrew-gloss.json` has xlit on **8,674/8,674 (100%)** and is already parsed — `token-package-loader.ts:794-795` uses it, but only for a reverse-orbit label; `resolveGloss` (`:500-524`) never copies it onto the card | **HAVE-BUT-HIDDEN** |
| 5 | **Pronunciation** | No | Yes (`pres-boo'-ter-os`) | `LanguageWordsSection.tsx:444-450` | **PARITY** (ahead) |
| 6 | **Strong's number** | `G0749`, zero-padded | `G749`, unpadded | `LanguageWordsSection.tsx:1273-1275`; `macula-greek-tsv.ts:233`, `oshb-osis.ts:153` | PARITY (cosmetic) |
| 7 | **Sense-disambiguated Strong's** | `G4245G`, `G0367I`, `H1254A` — the tag *is* the key; the plain number is never emitted | **No.** Plain only | `oshb-osis.ts:242-250` literally comments "strip homograph letter suffix" and drops it. `token-package-loader.ts:209` `/^[HG]\d{1,5}$/` would reject a suffixed key even if we shipped one | **HAVE-BUT-HIDDEN (Hebrew) / NEED-DATA (Greek)** — see §4 step 0 |
| 8 | **Sense-set metadata** ("this number splits into N senses, with counts") | `_detailLexicalTag` — a picker | No equivalent field | — | NEED-DATA (arrives with TBESG/TBESH col 2/3) |
| 9 | **Morphology in words** | `Function=Noun; Case=Genitive; …` as labelled rows | Yes, one line at the head: "Adjective · genitive plural masculine" | `LanguageWordsSection.tsx:1169-1182`, rendered `:1283-1295`; `morph-explain.ts`; `morph-labels.ts:158-194` | PARITY |
| 10 | **Morph code** | In `title=`/`allMorphsInVerse` | Yes, behind the form disclosure | `LanguageWordsSection.tsx:363-368` | PARITY |
| 11 | **Grammar "i.e." meaning line** | "DESCRIBING male people or things that something belongs to" | **Yes, verbatim the same sentence** | `step-morph.ts:254-258` parses it; `LanguageWordsSection.tsx:338-340` renders it. Verified in `TEGMC-STEPBible-CC-BY.txt` for `A-GPM`, `N-GSM`, `N-NSM`, `V-2AAI-3S` | **PARITY** |
| 12 | **Grammar "e.g." example line** | "teachings of _wise_ men" | **Yes, verbatim** | `step-morph.ts:256-258`; `LanguageWordsSection.tsx:341-346` | **PARITY** |
| 13 | **Case** | Emitted as `n-gen` class, **never painted** — zero hits in 220 KB of STEP CSS | Yes, in the kind line | `LanguageWordsSection.tsx:1174-1177` (case falls into `morphAgreement`); `morph-labels.ts:233` | **PARITY** (ahead) |
| 14 | **Occurrence gloss** | `gloss`, "high-priest" | Yes, MACULA/BSB gloss (Greek); Strong's short gloss (Hebrew) | `LanguageWordsSection.tsx:1298-1302`; `token-package-loader.ts:500-524` | PARITY |
| 15 | **Non-English glosses** (es / zh-Hans / zh-Hant) | Yes, via the language path segment | No | — | N/A (localisation, out of scope) |
| 16 | **"Meaning" — short/medium definition** | `mediumDef`, two lines. **Source is Mounce (NT) / abridged BDB (OT)** | Different prose: Strong's first sense, closed | `LanguageWordsSection.tsx:429-436` | **NEED-DATA** — TBESG `Meaning` col 8, **4,736,912 b, CC BY 4.0** (Abbott-Smith, *not* Mounce; longer and better, but will not look like STEP's paste). Hebrew: TBESH, 3,288,045 b, CC BY 4.0 **but see §5 rider** |
| 17 | **Full lexicon entry** | No such block | Yes — Strong's full + Thayer (Greek) / BDB (Hebrew) layered in one expander | `LanguageWordsSection.tsx:452-475`; `token-package-loader.ts:339-372` | **PARITY** (ahead: STEP's Hebrew "BDB definition" ships as the literal string "Not yet available") |
| 18 | **LSJ classical dictionary** | `lsjDefs`, ~1 KB formatted, citation tooltips | No | **NEED-DATA** — TFLSJ, **23,831,837 b** + `TFLSJ extra` 8,377,070 b, CC BY 4.0. 5,709 Greek entries, mean 3,559 chars. Needs a build-time shard step (precedent: TIPNR 8,611,754 b → `tipnr-index.json` 4,951,611 b) | NEED-DATA |
| 19 | **Which sense is used *here*** | Yes, by construction — the extended tag *is* the occurrence's sense | **Data present, not on the card.** Acts 24:1 πρεσβυτέρων carries LN `53.77` "elder / Roles and Functions"; ἀρχιερεὺς `53.89`; Ἀνανίας `93.24c` "Persons" | tokens carry `louwNida` + `semanticSenses` (`types.ts:84-93`). The card never reads them directly; they surface only inside the Senses tab as "Used here" meta (`RenderingOrbit.tsx:170-181`), and only when the lemma has ≥2 sense groups corpus-wide (`greek-senses.ts:225`) | **HAVE-BUT-HIDDEN** |
| 20 | **Sense inventory / semantic range** | Prose senses inside `mediumDef`/`lsjDefs`; `_detailLexicalTag` as a list | Yes — frequency-ranked, occurrence-counted, with "Used here" marked | `LanguageWordsSection.tsx:511-540, 648-649`; `greek-senses.ts:178-262` | **PARITY** (ahead — verdict D) |
| 21 | **Louw-Nida id + domain label** | Nothing comparable. `_step_Type` is `word`/`verb`/`God` | Domain label yes; **the LN id itself never rendered** | `louwNida` present on **127,291 of 137,779** Greek tokens (`macula-greek-tsv.ts:237`), reaches the renderer type (`api.ts:537`), **zero render sites** | **HAVE-BUT-HIDDEN** (ahead once shown) |
| 22 | **Related words / cognate family** | `relatedNos` — `archiereus = archē + hiereus`. Source **`@StepRelatedNos2`, not published in the CC BY repo** | No | Partial substitute derivable from TBESG/TBESH col 2 relation phrase + col 3 uStrong (`= a Meaning of`, `= the Greek of`, `= a Part of`, `= combination of`) — a real derivation graph, but **not** compound decomposition | **NEED-DATA, and no clean source exists.** Ask STEPBible |
| 23 | **Cross-language cognate bridge (H↔G)** | Yes, `_detailLexicalTag` reaches into Greek: `H3478`→`G2474 G2384H G2475` | Yes, by a different road: the reverse orbit crosses testaments on English | `LanguageWordsSection.tsx:1317-1324`; `token-package-loader.ts:706-733` (BSB-backed) | PARITY (different mechanism) |
| 24 | **Count in chapter** | **No — STEP has only book and bible** | Yes | `LanguageWordsSection.tsx:1337`; `indexes.ts:15-17, 44` | **PARITY** (ahead) |
| 25 | **Count in book** | Yes | Yes | `LanguageWordsSection.tsx:1339`; `indexes.ts:43` | **PARITY, and numerically exact — see §2.2** |
| 26 | **Count in Bible** | `counts.bible` | "in the corpus" = one package = one testament | `LanguageWordsSection.tsx:1341`; `indexes.ts:42`; `token-package-loader.ts:571` | PARITY for Greek (exact match), **label defect for Hebrew** — §2.2 |
| 27 | **Per-version frequency detail** (`freqList`, 31 slots) | Yes, behind a "Frequencies vary (why?)" tooltip | No | — | N/A — it exists to excuse STEP's own inconsistent numbers. We name one base text instead |
| 28 | **Hapax / rare flag** | Not a flag; derivable from `counts.bible === 1` | **Computed, never rendered.** `marksForVerse` emits `rare` at corpus freq ≤5 with a reason string | `indexes.ts:121-156`; returned in the DTO at `token-package-loader.ts:583-585, 751`; **no `card.marks` reference anywhere in `LanguageWordsSection.tsx`** | **HAVE-BUT-HIDDEN** |
| 29 | **Repeat-in-neighbourhood flag** | No | Computed, never rendered (same `marks` array, `repeat` kind, ±5 verses) | `indexes.ts:145-152` | **HAVE-BUT-HIDDEN** (ahead once shown) |
| 30 | **Other occurrences list** | "See related verses" — a search hand-off | Yes, inline: first 10 refs + forms + "you are here" | `LanguageWordsSection.tsx:1360-1378`; `indexes.ts:88-101` | **PARITY** (ahead — ours is in-panel, not a search) |
| 31 | **Immediate context (±2 words)** | No | **Computed, never rendered** | `indexes.ts:174-189`; DTO at `token-package-loader.ts:579, 749`; no render site | **HAVE-BUT-HIDDEN** |
| 32 | **Proper-name identity** | `briefDef` + `_step_Type: "man"` + `_searchResultRange` | Yes, and disambiguated per individual, with "N of M" collision stated on the name line | `LanguageWordsSection.tsx:740-855, 1312-1314`; `tipnr.ts:46-68`; TIPNR byte-identical to upstream | **PARITY** (ahead — verdict H) |
| 33 | **Person role / era / affiliation** | Inside `briefDef` prose | **On our data, and already rendered — in the other panel.** Word card shows only `brief`/`short` | `tipnr.ts:37-44` (`role`, `era`, `affiliation`); rendered at `LivingMargin.tsx:1813, 1843`; **absent from `NameEntityCard`** | **HAVE-BUT-HIDDEN** |
| 34 | **Family / genealogy** | A "Family" button → `j_people.json` | Same story: `relationships` shipped, rendered as "Family in the text" in the entity panel, **not reachable from the word card** | `tipnr.ts:43`; `LivingMargin.tsx:1547-1561, 1874` | **HAVE-BUT-HIDDEN** |
| 35 | **Place geography / map** | No | Lat/long + minimap exist (Pleiades), entity panel only | `src/core/entities/place-research.ts:34-46, 93` | **HAVE-BUT-HIDDEN** (ahead — verdict H) |
| 36 | **Syntactic role in the clause** | Nothing | **46,782 Greek tokens carry `role` (`v`, `s`, `o`, `io`, `o2`, `vc`, `adv`, `p`). Zero render sites.** Acts 24:1: `κατέβη` = v, `οἵτινες` = s | `macula-greek-tsv.ts:239`; `types.ts:96`; `api.ts:544`; grep for `token.role` in `src/renderer/` → nothing | **HAVE-BUT-HIDDEN** — the single largest unused field we own |
| 37 | **Clause / phrase structure** | Nothing comparable | Structure modal, linked from the card footer | `LanguageWordsSection.tsx:1407-1430`; `syntax-study.ts:622-750` (subject/predicate/complement/detail/connector) | **PARITY** (far ahead; rebuild is open task #18) |
| 38 | **English → lemmas behind it** | No | Yes, "Behind this word" | `LanguageWordsSection.tsx:600-601`; `token-package-loader.ts:706-733` | **PARITY** (ahead) |
| 39 | **Lemma → English spectrum** | No | Yes, "In English" | `LanguageWordsSection.tsx:598-599`; `rendering-orbit.ts` | **PARITY** (ahead) |
| 40 | **Hebrew prefixes as separate glossed words** | Yes — `H9003 "/ב" "in/on/with"`, `H9009 "[the]"`, `H9020 "my"`. 31 pseudo-tags; **33.8% of visible Hebrew word tokens** | **No.** We keep morphemes glued: Gen 1:1 token 1 is `בְּ/רֵאשִׁ֖ית`, one token, `H7225`, `HR/Ncfsa` | `oshb-osis.ts:126-160`; verified in `oshb-wlc/tokens.jsonl`. TEHMC already covers the H9xxx range | **HAVE-BUT-HIDDEN** (a package-build change, no new corpus) |
| 41 | **Source / licence attribution** | Provenance in `title=` tooltips | Yes, explicit, per-source, with licence, plus laurel ink for third-party prose | `LanguageWordsSection.tsx:178-225, 1379`; `SourcesDisclosure.tsx` | **PARITY** (well ahead) |
| 42 | **Capture to a note** | No | Yes, with attribution baked into the excerpt | `LanguageWordsSection.tsx:231-262, 1392-1406` | **PARITY** (ahead) |
| 43 | **Topical / subject index** | `{root, heading, seeAlso}`, Nave's-class, installed | No | NEED-DATA — public-domain Nave's exists | NEED-DATA |
| 44 | **Cross-references** | 44 per chapter, the ESV apparatus | No | NEED-DATA — TSK (public domain) or OpenBible (CC BY) | NEED-DATA |
| 45 | **Related verses engine** | 43 verses for Acts 24:1; ranking not exposed | No — but we have authored connections, which is a different and better thing | `LivingMargin.tsx:2313-2360`; `ConnectionUnderlay.tsx` | N/A |
| 46 | **Translation TIPS** | An external link, and `translationTipsFN` is **empty on all 349+ verses harvested** | No | — | N/A (not local data even for STEP) |
| 47 | **Red-letter mode** | Yes — **and it strips every `strong=`/`morph=` span inside Jesus' speech** | No | — | N/A — deliberately do not copy |

Tally: **21 PARITY, 12 HAVE-BUT-HIDDEN, 8 NEED-DATA, 6 N/A.** The designer's practical
reading: twelve of the fields below the fold need *no new data at all*, only a render site.

### 2.1 Where each side is ahead

**Ahead for us:** occurrence-bound Louw-Nida semantic domains; MACULA syntactic role and the
clause-structure drill-down; chapter-scope counts; forward and reverse rendering orbits;
in-panel occurrence lists; per-source licence disclosure; capture-to-note; authored
connections. STEP has none of these.

**Ahead for STEP:** sense-precise Strong's keys, LSJ prose, a related-words graph,
Hebrew morpheme-level tokens, cross-references, a topical index, and per-word DOM
addressability on the running text.

**Exact parity, same bytes:** the grammar block. TEGMC (467,056 b) and TEHMC (394,580 b) are
byte-identical to upstream, `step-morph.ts` `parseStepFullTable` captures
`{code, phrase, explanation, example}`, and `LanguageWordsSection.tsx:325-347` renders the
`i.e.` explanation and the `e.g.` example. STEP's remaining advantage there is presentational
only: hue for gender, weight for number, an animated underline for verb tense on the running
text, and case deliberately withheld.

### 2.2 Counts — the exact numbers

Recomputed from `data/scripture/packages/macula-greek-nestle1904/tokens.jsonl` against STEP's
harvested `counts` for Acts 24:1:

| word | STEP book / bible | ours book(ACT) / corpus |
|---|---|---|
| G0749 ἀρχιερεύς | 22 / 122 | **22 / 122** |
| G4245G πρεσβύτερος | 18 / 66 | **18 / 66** |
| G4489 ῥήτωρ | 1 / 1 | **1 / 1** |

Identical. Two consequences:

1. **We are at parity on Greek counts and ahead by a scope** (chapter, which STEP lacks). Our
   lemma-keyed denominator agrees with STEP's Strong's-keyed one for these words because
   MACULA's lemma and STEP's plain number partition the NT the same way.
2. **STEP's `counts` does not disambiguate by sense despite the key looking like it does.**
   `G4245G` returns 66 — the total for *all* of πρεσβύτερος, both senses. STEP's own sense
   picker reports 222 / 8 for `G4245G` / `G4245H` from a different endpoint. The two surfaces
   disagree; ours does not, because we only ever claim one thing.

Hebrew diverges, and diagnostically:

| | STEP bible | ours (whole OT) |
|---|---|---|
| H0430G elohim | 10,296 | 2,600 |
| H3068G YHWH | **10,296** | 6,521 |
| H0853 (obj. marker) | 10,938 | 10,979 |
| H1254A bara | 53 | 54 (merged) |
| H8064 shamayim | 459 | 421 |

STEP returns the **identical figure for elohim and YHWH — two different words.** Both sit in
the same 33-member divine-name cluster, so STEP's Hebrew `bible` is a cluster total, not a
count of the word. Ours is a count of the word. **Do not chase parity on that number.** What
we should fix is the *label*: `LanguageWordsSection.tsx:1341` reads "in the corpus", and for
`oshb-wlc` that means the Old Testament and for `macula-greek-nestle1904` the New. Say "in
the Old Testament" until the two packages are unioned.

---

## 3. Proposed `TokenCard` data shape

This is a **spec, not an implementation.** It is a superset of today's `TokenCardDto`
(`src/host/token-package-loader.ts:77-169`), keeping that file's naming conventions and
`src/core/language/types.ts`'s doc-comment style: camelCase fields, `?` for genuinely
absent data, `| null` for "resolved and came back empty", string unions over enums.

Availability tags on every field:

- `[NOW]` — populated today and drawn on the card.
- `[NOW·HIDDEN]` — populated today, reaches the renderer, **no render site**. Free to draw.
- `[NOW·DERIVE]` — computable from data on disk, needs a parser or loader change, no download.
- `[NEEDS <dataset>]` — requires a dataset we do not ship.

Optionality rules stated once, because they drive the layout: **Greek-only** fields are
absent for every OT token, **Hebrew-only** fields absent for every NT token, and every
lexicon-backed field is absent for the ~33.8% of visible Hebrew tokens that are H9xxx
function morphemes with no lexicon entry at all. A designer must assume any block can be
missing and the card must not leave a hole.

```ts
/**
 * Everything the word card can draw for one token.
 * Superset of TokenCardDto. Field order follows the card's reading order,
 * not the payload's.
 */
export type TokenCard = {
  // ─── Identity ────────────────────────────────────────────────────────────
  /** The token itself, verbatim from the package. */            // [NOW]
  token: TokenRecord;
  /** Surface as printed: OSHB morpheme slashes removed, RTL-safe. */ // [NOW]
  displaySurface: string;

  /**
   * Sense-disambiguated Strong's key — STEP's `G4245G` / `H1254A`.
   * THE JOIN KEY for every lexicon block below (§4 step 0).
   * Hebrew: derivable now, the letter is already in `token.lemma`
   *   ("l/1254 b") and thrown away by oshb-osis.ts:242-250.
   * Greek: needs TBESG col 2, no local source.
   */
  strongExtended?: string;          // [NOW·DERIVE] Hebrew / [NEEDS TBESG] Greek
  /** Plain Strong's, zero-padded to 4 (`G0749`) for upstream joins. */
  strongPadded?: string;                                          // [NOW·DERIVE]
  /**
   * Sibling senses this plain number splits into, so the card can say
   * "one of 3 senses of H7200" instead of silently picking.
   * Absent when the number does not split — which is the common case:
   * 109 of 10,847 Greek bases split, 1,391 of 8,723 Hebrew bases.
   */
  senseSiblings?: Array<{
    strongExtended: string;
    gloss: string;
    /** Relation phrase from TBESG/TBESH col 2, e.g. "a Meaning of". */
    relation?: string;
  }>;                                                  // [NEEDS TBESG/TBESH]

  // ─── Head line ───────────────────────────────────────────────────────────
  /** Short pastor-facing gloss. Lexicon prose stays in `definition`. */ // [NOW]
  gloss: string | null;
  glossSource: "package" | "strongs-hebrew" | null;               // [NOW]
  /**
   * Transliteration. Greek 97% via strongs-plus; Hebrew only 57% today
   * because the card reads definition.xlit — strongs-hebrew-gloss.json
   * has it for 8,674/8,674 and resolveGloss already holds the entry.
   */
  transliteration?: string;                        // [NOW] grc / [NOW·HIDDEN] hbo
  /** Strong's-style pronunciation respelling. Greek/Hebrew where present. */
  pronunciation?: string;                                         // [NOW]

  // ─── Grammar ─────────────────────────────────────────────────────────────
  morphLabels: string[];                                          // [NOW]
  morphExplain: MorphExplanation | null;                          // [NOW]
  /** TEGMC/TEHMC overlay: the i.e. explanation and e.g. example. */
  stepMorph: StepMorphOverlay | null;                             // [NOW]
  /**
   * MACULA syntactic role: v, s, o, io, o2, vc, adv, p.
   * Greek only — 46,782 of 137,779 tokens. Largest unused field we own.
   */
  role?: string;                                          // [NOW·HIDDEN] grc

  // ─── Sense ───────────────────────────────────────────────────────────────
  /** Louw-Nida id for THIS occurrence, e.g. "53.77". Greek only. */
  louwNida?: string;                                      // [NOW·HIDDEN] grc
  /** Domain label for that id, e.g. "Roles and Functions". */
  louwNidaDomain?: string;                                // [NOW·HIDDEN] grc
  /** Frequency-ranked sense range with the current occurrence marked. */
  semanticSenses: GreekSemanticSenseOutline | null;               // [NOW] grc

  // ─── Lexicon prose ───────────────────────────────────────────────────────
  /**
   * Strong's full entry + Thayer (grc) / BDB (hbo) layered underneath.
   * null for H9xxx function morphemes — no lexicon entry exists.
   */
  definition: {
    firstSense: string;
    full: string;
    xlit?: string;
    pronunciation?: string;
    source: string;
    id: string;
    deeper?: {
      firstSense: string;
      full: string;
      source: string;
      id: string;
      xlit?: string;
      senses?: Array<{ n: string; text: string; label?: string }>;
    } | null;
  } | null;                                                       // [NOW]

  /**
   * Short definition — STEP's "Meaning" slot.
   * Greek: TBESG col 8 (Abbott-Smith 1922, PD), mean 333 chars, 11,035 entries.
   * Hebrew: TBESH col 8 — CARRIES A PERMISSION RIDER, see §5. Deprioritised.
   * HTML: <b> <i> <BR /> <ref='Mat.8.1'> — needs a sanitiser, not innerHTML.
   */
  meaning?: {
    html: string;
    source: string;           // "Abbott-Smith (TBESG)" etc.
    licence: string;
  };                                                   // [NEEDS TBESG/TBESH]

  /**
   * Full LSJ classical entry. Greek only, 5,709 entries, mean 3,559 chars.
   * 539 rows are the honest stub "(From Abbott-Smith. LSJ has no entry)" —
   * treat that as absent, do not draw an empty expander.
   * Citation bibliography hides in <a title="…">; <Level2>/<Level3> mark
   * the sense nesting and must become real structure, not literal tags.
   */
  lsj?: {
    html: string;
    levels?: Array<{ depth: 2 | 3; label: string; html: string }>;
    source: string;
    licence: string;
  };                                                     // [NEEDS TFLSJ] grc

  /**
   * Cognate family. STEP's `archiereus = archē + hiereus`.
   * NO CC BY SOURCE EXISTS (§4 step 9). `derivation` is the honest partial
   * from TBESG/TBESH col 2+3 — a unification graph, NOT decomposition.
   * Keep the two shapes separate so the label can stay truthful.
   */
  relatedWords?: Array<{ strongExtended: string; lemma: string;
                         transliteration?: string; gloss?: string }>; // [NEEDS @StepRelatedNos2 — unpublished]
  derivation?: Array<{ strongExtended: string; relation: string;
                       lemma: string; gloss?: string }>;   // [NEEDS TBESG/TBESH]

  // ─── Identity: people and places ─────────────────────────────────────────
  nameEntity: {
    entity: TipnrEntity;
    match: NameResolveHit["match"];
    alternatives: TipnrEntity[];
    licensed: LicensedSource | null;
    /**
     * Already on `TipnrPersonProfile` (tipnr.ts:36-44), drawn in LivingMargin,
     * absent from the card. `role` is required on that type; `era` and
     * `affiliation` are optional there and stay optional here.
     */
    profile?: TipnrPersonProfile;                             // [NOW·HIDDEN]
    /**
     * Pleiades location, places only. Field names follow `PlaceLocation`
     * (src/core/entities/place-research.ts:34-45) — longitude/latitude, not
     * lon/lat — and it carries its own `confidence`, which the card must
     * show rather than implying a precision the source disclaims.
     */
    location?: PlaceLocation;                                 // [NOW·HIDDEN]
  } | null;                                                       // [NOW]

  // ─── Orbits ──────────────────────────────────────────────────────────────
  renderingOrbit: RenderingOrbit | null;                          // [NOW]
  reverseOrbit: ReverseOrbit | null;                              // [NOW]

  // ─── Frequency and context ───────────────────────────────────────────────
  lemmaFreq: {
    chapter: number;                                              // [NOW]
    book: number;                                                 // [NOW]
    /**
     * ONE PACKAGE = ONE TESTAMENT. Not the Bible. The card currently
     * labels this "in the corpus"; say "in the Old Testament" /
     * "in the New Testament" until the packages are unioned.
     */
    corpus: number;                                               // [NOW]
    /** What `corpus` actually spans, so the label cannot lie. */
    corpusScope: "old-testament" | "new-testament" | "bible";     // [NOW·DERIVE]
    /**
     * Counted on `strongExtended` rather than lemma. Differs from `corpus`
     * only for split bases — but there it is the difference between
     * bara "create" (53) and bara + "fatten" (54).
     */
    corpusBySense?: number;                                   // [NOW·DERIVE] hbo
  };
  /** ±2 tokens. Computed on every card call today and discarded. */
  neighborhood: { before: TokenRecord[]; after: TokenRecord[] };  // [NOW·HIDDEN]
  occurrencesInBook: TokenRecord[];                               // [NOW]
  /** `rare` at corpus freq ≤5, `repeat` within ±5 verses, each with a reason. */
  marks: TokenMark[];                                             // [NOW·HIDDEN]

  // ─── Provenance ──────────────────────────────────────────────────────────
  /**
   * Per-block attribution. Every prose block above that came from a third
   * party must be nameable at the render site (Law 3·3), so this is not
   * optional decoration — a block whose source cannot be named must not draw.
   */
  sources: Array<{
    block: "gloss" | "morph" | "definition" | "meaning" | "lsj"
         | "relatedWords" | "derivation" | "nameEntity" | "geo" | "senses";
    name: string;
    licence: string;
    attributionText: string;
  }>;                                                             // [NOW]
};
```

**Fields deliberately not in this shape.** STEP's `freqList` (31 per-version slots) exists to
excuse STEP's own inconsistent numbers; we name one base text instead. `translationTipsFN` is
empty on all 349 verses harvested. Non-English glosses are out of scope until localisation
lands. Red-letter mode is not copied at all — STEP's strips word tagging from exactly the
words most likely to be studied.

---

## 4. Ordered, costed plan

Ordered by (value ÷ cost), cheapest first. Steps 1–6 need **no download**: the data is on
disk and the work is a render site or a parser line. Steps 7–9 need new datasets.

### Step 0 — Decide the join key: extended Strong's. **Prerequisite for steps 7–8, not for 1–6.**

This is first because it determines the key for everything after it.

**What it is.** STEP never emits a plain Strong's number where it has disambiguated a lemma:
Acts 24:1 gives `G4245G` ("elder: Elder", the office) with `_detailLexicalTag G4245H`
("elder: old", age). Plain `G4245` simply does not occur in STEP output. TBESG/TBESH/TFLSJ
are keyed the same way, on **column 2, `dStrong`**.

**Measured scale** (recomputed independently from the upstream files, not taken from the
harvest):

| file | data rows | suffixed `dStrong` | distinct bases | bases that split | mean col-8 chars |
|---|---|---|---|---|---|
| TBESG (Greek) | 11,035 | 295 | 10,847 | **109** | 333 |
| TBESH (Hebrew) | 11,682 | 4,350 | 8,723 | **1,391** | 216 |
| TFLSJ (Greek) | 5,709 | 292 | 5,523 | 108 | 3,559 |

**Greek is a 109-word problem; Hebrew is a 1,391-word problem.** In a 459-verse harvest,
20.3% of tagged occurrences carried a suffixed tag, and 166 distinct STEP tags collapsed onto
71 plain numbers. Suffix letters run `G…Z` and then **lowercase `a…z`** in TBESH (`H2148y`,
`H5838w`) — any parser must be case-preserving.

**Why it changes an answer, not a layout.** `H1254` *bara*. Our OSHB tokens, counted:

```
'1254 a'    42   DEU 4:32, ECC 12:1, EXO 34:10   → bara, "to create"
'c/1254 a'  10   AMO 4:13, EZK 23:47, GEN 1:21   → bara, "to create"
'b/1254 a'   1   GEN 2:4                          → bara, "to create"
'l/1254 b'   1   1SA 2:29  לְ/הַבְרִֽיאֲ/כֶ֗ם      → "to fatten yourselves"
```

53 occurrences of *bara* "create", **1** of the homonym "fatten". STEP: `H1254A` bible = 53.
Ours: `H1254` = **54**. A pastor studying the word behind "In the beginning God created" is
told it occurs 54 times, and one of those is Eli's sons stuffing themselves with the fat of
the offerings. Not a rounding error — a category error, on the Frequency line at
`LanguageWordsSection.tsx:1341`. `H7200` (*ra'ah*, "to see") is worse: it splits into "see",
"select", and **"Provider [God]"** — *Yahweh-Yireh*, Gen 22:14. One plain number covering
both "he looked" and a divine name.

**Verdict, and the justification.** Split the decision by testament:

- **Hebrew: adopt now, before anything else.** It costs nothing and it is not a download.
  The letter is already in the shipped token — **59,282 of 306,774 OSHB tokens (19.3%) carry
  an OSHB homonym letter in `lemma`, across 535 distinct bases with more than one letter** —
  and `oshb-osis.ts:242-250` strips it under a comment that says so. Two changes: keep the
  letter, and lift the `/^[HG]\d{1,5}$/` gate at `token-package-loader.ts:209` that would
  reject a suffixed key. This is the single highest-value change in this document.
- **Greek: defer, and it is safe to defer.** There is no local Greek source for the suffix —
  it arrives *with* TBESG. And Greek barely needs it: 109 split bases out of 10,847.
- **Not a prerequisite for TFLSJ.** LSJ is keyed on `dStrong`, but 5,601 of its 5,709 rows are
  unsuffixed, so a plain→padded join lands correctly for 98% of Greek entries. Ship LSJ
  first, refine the key later.
- **It IS a prerequisite for honest sense-split counts and for `senseSiblings`.** Those two
  cannot be faked from a plain key.

**Risks.** A plain→extended map is not exposed as data anywhere:
`~/Library/Application Support/JSword/step/entities/augmentedStrongs/` is empty on this
install, and STEP derives it by appending `G` (`ModuleController.appendStrongSuffix`), which
is why `H0430` silently resolves to `H0430G`. Derive the map from TBESG/TBESH col 1 → col 2
instead of guessing a letter. Our three lexicon JSONs use **three different key formats** —
`bdb-kjv.json` `H430`, `strongs-plus.json` `H430`, `strongs-hebrew-gloss.json` bare `430` —
so normalisation is per-file, not global. Getting this wrong silently *merges* senses rather
than erroring, which is the failure mode that will not show up in a test that only checks for
a non-empty result.

### Step 1 — Hebrew transliteration onto the card. No download.

**Unlocks** field 4: Hebrew transliteration from 57% → 100%.
**Dataset:** none. `data/scripture/lexicons/strongs-hebrew-gloss.json` (1,062,255 b, already
shipped) carries `xlit` on **8,674/8,674 entries**, and `resolveGloss`
(`token-package-loader.ts:500-524`) already holds the entry in hand — its return type simply
has no `xlit` slot, so the value is dropped. **Index:** none.
**Risk:** low. The two files disagree on romanisation style (`ʼâb` with combining diacritics
vs STEP's syllable-dotted `e.lo.him`); pick one and state it, do not mix per-token.

### Step 2 — Draw `marks` and `neighborhood`. No download.

**Unlocks** fields 28, 29, 31 — hapax/rare flag, repeat-in-passage, ±2-word context.
**Dataset:** none. Both are computed on **every** card call and thrown away: `marks` at
`token-package-loader.ts:583-585`, `neighborhood` at `:579`. Confirmed zero references to
either in `LanguageWordsSection.tsx`. **Index:** none.
**Risk:** the `rare` threshold is corpus freq ≤5, and "corpus" is one testament (step 6) — a
word rare in the NT may be common in the LXX. Label the scope in the reason string.

### Step 3 — Draw MACULA `role`. No download.

**Unlocks** field 36 — the clause role of this word, which STEP has nothing comparable to.
**Dataset:** none. **46,782 of 137,779 Greek tokens** carry `role`; it reaches the renderer
type at `api.ts:544` and has **zero render sites** (the 41 `role-*` hits in the renderer are
CSS classes from the syntax tree, plus `person.role` and `member.role`, none of them this
field). **Index:** none.
**Risk:** Greek only — the card must degrade silently for all OT tokens. Codes are terse
(`v`, `s`, `o`, `io`, `o2`, `vc`, `adv`, `p`) and need a label table; `io`/`o2` in particular
must not be shown raw.

### Step 4 — Louw-Nida id and "used here" on the card. No download.

**Unlocks** fields 19, 21 — which sense is in play *at this occurrence*.
**Dataset:** none. `louwNida` is present on **127,291 of 137,779** Greek tokens; the only
renderer reference is the type declaration at `api.ts:537`. `semanticSenses` surfaces "Used
here" only inside the Senses tab (`RenderingOrbit.tsx:170-181`) and only when the lemma has
≥2 sense groups corpus-wide (`greek-senses.ts:225`). **Index:** none.
**Risk:** the id (`53.77`) is meaningless to a reader without the domain label; draw the
label and treat the id as secondary.

### Step 5 — Reach the entity data from the word card. No download.

**Unlocks** fields 33, 34, 35 — person role/era/affiliation, family, place coordinates.
**Dataset:** none new. TIPNR (8,611,754 b) is already shipped byte-identical and already
indexed to `tipnr-index.json` (4,951,611 b); `tipnr.ts:37-44` carries `role`, `era`,
`affiliation`, `relationships`, all drawn in `LivingMargin.tsx:1813, 1843, 1547-1561, 1874`
and **absent from `NameEntityCard`**. Place geo is `src/core/entities/place-research.ts:34-46, 93`.
**Index:** none. **Risk:** duplication between two panels showing the same prose; decide
which one is canonical rather than rendering both.

### Step 6 — Stop calling one testament "the corpus". No download.

**Unlocks** field 26 — removes an outright false label.
**Dataset:** none. `LanguageWordsSection.tsx:1341` reads "in the corpus"; the denominator is
`lemmaFreqCorpus` over a single package (`indexes.ts:42`, `token-package-loader.ts:571`), so
it is the OT for `oshb-wlc` and the NT for `macula-greek-nestle1904`.
**Index:** none. **Risk:** none. This is a string and a `corpusScope` field.

### Step 7 — TFLSJ, the full LSJ entry. **The highest-value download.**

**Unlocks** field 18, the one substantial block STEP has and we have nothing for.

| | |
|---|---|
| Dataset | `TFLSJ  0-5624 - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt` — **note the double space after `TFLSJ`** |
| Size | **23,831,837 b** (confirmed `content-length`) |
| Plus | `TFLSJ extra - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt`, **8,377,070 b**, for G6000+ |
| Licence | CC BY 4.0 — attribute STEPBible.org |
| Path | `https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/` (percent-encode the spaces) |
| Format | UTF-8 **with BOM**, prose preamble, column header on line 61, data from line 64. 8 tab-separated columns, one line per record, **no `$` separators** — the multi-line `$` form belongs to TIPNR/TEGMC, not to these |
| Columns | `1 eStrong  2 dStrong  3 uStrong  4 Greek  5 Transliteration  6 Morph  7 Gloss  8 "LSJ Meaning"` |
| Rows | 5,709 data rows, col 8 non-empty in 100%, mean 3,559 chars |

**Index: yes, mandatory, and sharded.** Precedent is exact: TIPNR 8,611,754 b →
`tipnr-index.json` 4,951,611 b. But 20 MB of prose must not be one blob — a word card needs
**one** entry, and the panel should not pay 24 MB to render it. Shard by Strong's-thousand
(`tflsj-0.json`, `tflsj-1.json`, …), keyed on `dStrong`, with a plain→extended sidecar
derived from col 1 → col 2 so `G749` still finds `G0749`.

**What could go wrong.** (a) Col 8 is HTML, and the citation bibliography hides in
`<a href="javascript:void(0)" title="…">` — the `title` is the content, the `href` is a
no-op; rendering the anchor as a link produces dead links, and passing it to `innerHTML`
ships a `javascript:` URL. Sanitise to a real structure. (b) `<Level2>`/`<Level3>` are
sense-nesting markers, not HTML — they must become structure or they will print literally.
(c) **539 rows are the stub `"(From Abbott-Smith. LSJ has no entry)"`** — treat as absent, or
the card grows an expander that opens onto an apology. (d) Greek only; nothing for the OT.
(e) The harvest's original filenames for both TFLSJ files **404** — the word order differs and
there is a double space. Use the paths above, which were verified 200 with matching
`content-length`.

### Step 8 — TBESG, the "Meaning" block (Greek).

**Unlocks** field 16, Greek half. **Sets expectations:** this will **not** look like STEP's
paste. STEP's "Meaning" is `mediumDef` = Mounce (NT) / abridged BDB (OT), and neither is in
the published CC BY corpus — grepping STEP's exact live strings across all three upstream
files returns **0 hits**, and `Lexicons/` contains exactly four files, no Mounce, no BDB.
TBESG col 8 is **Abbott-Smith 1922** (public domain, Tyndale-corrected): longer, with LXX
equivalents and NT reference lists, and differently shaped.

| | |
|---|---|
| Dataset | `TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt` |
| Size | **4,736,912 b** (confirmed `content-length`, and byte-identical to the local copy) |
| Licence | CC BY 4.0 |
| Path | same `Lexicons/` directory as step 7 |
| Format | header line 88, data from line 91, 11,035 data rows, col 8 label is literally `Abbott-Smith lexicon (AS), with gaps occationally filled from edited versions of  Middle LSJ` (typo and double space upstream) |

**Index: yes**, `tbesg-index.json`, ~3.7 MB, keyed on `dStrong`. Small enough not to shard.
**Bonus:** col 2's relation phrase + col 3 `uStrong` yield the `derivation` graph and
`senseSiblings` of §3 for free — the honest partial for field 22.
**Risk:** same HTML sanitising as step 7. Abbott-Smith's `<ref='Mrk.2.26; 14.47'>` refs are
semicolon-separated *inside* one attribute and use their own book abbreviations — parsing
them as our refs needs a mapping, and getting it wrong produces links to the wrong verse.

### Step 9 — Everything left, with an honest verdict on each.

| want | source | verdict |
|---|---|---|
| **Related words** (`archiereus = archē + hiereus`) | `@StepRelatedNos2` | **No CC BY source exists.** Not in the published repo. STEP ships it inside a prebuilt Lucene index (`~/Library/Application Support/JSword/step/entities/definition/`, 52 MB); extracting it means lifting STEP-authored scholarship out of another application's binary — **do not**. The payload is bare numbers (`"G0746, G2409"`), ~400 KB, arguably fact rather than expression, and the STEPBible licence invites contact. **Ask them.** Ship `derivation` from step 8 in the meantime, labelled as what it is |
| **"Meaning" (Hebrew)** | TBESH col 8, 3,288,045 b | **Deprioritise.** Licence rider, §5. We already ship `bdb-kjv.json` (3,014,754 b), so this is the least urgent of the three and the only one with a hazard |
| **Cross-references** | TSK (PD) or OpenBible (CC BY) | Separate project. `docs/openbible-cross-references.md` already exists |
| **Topical index** | Nave's (PD) | Separate project |
| **Hebrew morphemes as separate glossed tokens** | none — package-build change | Field 40. TEHMC (394,580 b, shipped) already covers the H9xxx range. Real work, no download |
| **Versification map** | STEPBible TVTMS | Not cosmetic — open task #28. The **shape exists and is empty**: `VersificationMap`/`VersificationRule` are declared at `src/core/reference/types.ts:56-66` and re-exported at `src/core/reference/index.ts:10-11`, but the type is **never loaded or applied anywhere in `src/`**, the only two data files are `data/scripture/versification/kjv.json` (313 b) and `web.json` (288 b) and **both carry `"rules": []`**, and there is **no map for `oshb-wlc` at all**. So the fix is data plus a call site, not a design. Why it matters: STEP resolves `ESV/Psa.51.1` → `Ps.51.3` but `OSHB/Psa.51.1` → `Ps.51.1` (the superscription). Ask an English module and a Hebrew module the same question and get two different verses |

---

## 5. Licence

**This project is non-commercial and free.** That changes the answer to questions the older
doc settled for a commercial build.

| Dataset | Size | Licence | Usable here | Attribution |
|---|---|---|---|---|
| TEGMC | 467,056 b | CC BY 4.0 | **Shipping**, byte-identical | STEPBible.org |
| TEHMC | 394,580 b | CC BY 4.0 | **Shipping**, byte-identical | STEPBible.org |
| TIPNR | 8,611,754 b | CC BY 4.0 | **Shipping**, byte-identical | STEPBible.org |
| TBESG | 4,736,912 b | CC BY 4.0 | **Yes** | STEPBible.org + Abbott-Smith (PD) |
| TFLSJ | 23,831,837 b | CC BY 4.0 | **Yes** | STEPBible.org + LSJ 9th ed. (PD) |
| TFLSJ extra | 8,377,070 b | CC BY 4.0 | **Yes** | as above |
| TBESH | 3,288,045 b | CC BY 4.0 **with a rider** | **Col 8 only, with permission** | see below |
| TTESV (ESV word tags) | — | **CC BY-NC** | **Yes — non-commercial is our case** | STEPBible.org |
| MorphGNT morph | — | CC BY-SA | **Yes**, share-alike on derivatives | MorphGNT |
| `@StepRelatedNos2` | ~400 KB | **unpublished** | **No** — ask STEPBible | — |

**CC BY-NC and CC BY-SA are both usable here, with attribution.** BY-NC is fine because the
project is non-commercial; BY-SA is fine provided derivative *data* carries the same licence.

**TTESV gives TAGS, not the ESV TEXT.** This distinction matters and is easy to lose: the
word tags are CC BY-NC and usable, but the ESV text itself is Crossway's and would need a
separate agreement. Shipping TTESV does **not** put us any closer to shipping the ESV.

**The TBESH rider, verbatim from line 48 of the file**, inside a file labelled CC BY:

> "These are based on the Abridged BDB by Online Bible, © Larry Pierce of OnlineBible.net
> <olbsupport@onlinebible.net>. They are for guidance only. Permission should be gained from
> Online Bible before these are applied in any project."

Non-commercial does not cure this — the rider is a permission request, not a commercial
restriction. Treat TBESH col 8 as **not clean** until asked. The rest of TBESH (cols 1–7,
the join keys and the derivation graph) is unaffected.

**Mounce is not obtainable honestly.** STEP's "Meaning" block is Mounce (NT) / abridged BDB
(OT), served from a prebuilt Lucene index inside the installer. All 11,035 Greek + 11,682
Hebrew `mediumDef` values could be harvested off localhost in about 30 s / ~145 MB. That
would be extracting a licensed third-party lexicon from another application's binary. **Do
not.** Use TBESG (step 8) and say whose lexicon it is.

### `docs/original-language-data-sources.md` is stale — this document supersedes it

That doc was written for a **commercial** build. Its licence guidance is now wrong for this
project, and it is specific enough to be re-derived by a future reader as current. Confirmed
stale lines, quoted:

| line | text | why stale |
|---|---|---|
| 29 | "**Avoid for commercial v0 without counsel**" — section heading | The whole section's premise |
| 33 | "STEPBible **TTESV** (ESV tags) \| **CC BY-NC** — non-commercial" | Listed as a reason to avoid; here it is a reason it is fine |
| 138 | "**Exception:** **TTESV = CC BY-NC**" | Framed as an exception to avoid |
| 149 | "**TTESV** \| ESV word tags — **BY-NC only**" | "only" reads as disqualifying |
| 151 | "Skip TTESV for commercial builds." | Direct instruction, wrong premise |
| 324 | "Ship TTESV (ESV tags) \| **No** for commercial without separate rights" | Reads as a flat no |
| 325 | "Claim "ESV reverse interlinear" \| Needs Crossway…" | **Still true** — this line is correct and is the tags-vs-text distinction above |

**Not edited.** Recorded here only. When that file is next revised it needs a superseded
banner rather than a quiet in-place fix, so it stops being cited as current. Two further
things belong in whatever supersedes it: TBESH's Online Bible rider, and the fact that
STEP's on-screen "Meaning" is Mounce rather than Abbott-Smith.

---

## 6. Open questions

1. **`@StepRelatedNos2` licensing.** Is the related-words number list separately licensable,
   or publishable in the CC BY repo? It is the only field in this comparison with no
   substitute. STEPBible answer email and the licence invites contact. **Unresolved — needs
   a human to ask.**
2. **TBESH col 8 permission.** Would Online Bible grant use for a free, non-commercial,
   attributed app? Until asked, Hebrew "Meaning" stays unshipped. **Unresolved.**
3. **Which Louw-Nida domain label do we print?** MACULA carries the id and our join produces
   a label, but STEP has no equivalent, so there is no reference to match. Designer's call,
   not a data question.
4. **Whether the two packages should be unioned into a real Bible-scope count.** Step 6 fixes
   the *label*; it does not make the number Bible-scope. Unioning `oshb-wlc` and
   `macula-greek-nestle1904` would, but the two are keyed differently (lemma strings do not
   cross testaments) so the denominator would have to move to extended Strong's first.
   **Depends on step 0.**
5. **Hebrew transliteration house style.** `strongs-hebrew-gloss.json` gives `ʼâb`; STEP gives
   syllable-dotted `e.lo.him`. Different systems, both defensible, must not be mixed. Not
   settled.
6. **Does anything need STEP's `_detailLexicalTag` cross-language clusters?** For Hebrew it
   lists Greek counterparts (`H3478` → `G2474 G2384H G2475`), an OT→NT quotation bridge that
   may be more useful than LSJ prose. But it is a *co-reference cluster*, not a cognate
   family — `H0430G` returns 33 members including six Greek numbers, and the same field on
   `H3068G` returns the identical 33. Whether that is a feature or noise is unsettled, and
   the field is not in the published files.
7. **Greek extended Strong's before or after TBESG.** Step 0 defers it on the grounds that
   109 of 10,847 bases split. If a specific high-traffic word (ψυχή splits 5 ways, ποιέω 4)
   turns out to matter more than the ratio suggests, that judgement changes.
8. **Poetry indent levels** (open task #19). STEP's server ships `level1`/`level2`/
   `startLineGroup` per line, which is exactly the missing datum, and the origin is the OSIS
   `<l level=…>` in the translation module — a package-build change on our side. Not settled
   whether our package format should carry it.

---

## Reproducing the measurements

```bash
# live STEP word payload (local install, not the public host)
curl -s "http://localhost:8989/rest/module/getInfo/ESV/Acts.24.1/G0749/N-NSM/en"

# upstream sizes without downloading
curl -s "https://api.github.com/repos/STEPBible/STEPBible-Data/contents/Lexicons"

# our counts, recomputed from the shipped package
python3 -c "
import json,collections
c=collections.Counter()
for l in open('data/scripture/packages/macula-greek-nestle1904/tokens.jsonl'):
    t=json.loads(l); c[t.get('lemma')]+=1
print(c['ἀρχιερεύς'], c['πρεσβύτερος'], c['ῥήτωρ'])   # 122 66 1
"
```
