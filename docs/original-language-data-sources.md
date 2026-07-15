# Public original-language word data (programmatic)

Sources for a **data-first** language layer: tokens, lemmas, morphology, glosses, counts, local concordance, and translation alignment — without custom linguistic judgment.

Status: research inventory (2026-07). Prefer **TSV / plain text** over XML trees for v0 ingest.

**Product history & future options:** what we shipped (morph expanders, STEP
Approach A, TIPNR people/places), freeze decisions, and deferred menu
(translation braid, lexicon depth, etc.) live in
[`docs/language-margin-history.md`](./language-margin-history.md).

---

## Recommended v0 stack

| Need | Source | Format | License | Notes |
|------|--------|--------|---------|-------|
| **Greek NT tokens + morph + lemma + Strong’s + gloss** | [Clear-Bible/macula-greek](https://github.com/Clear-Bible/macula-greek) Nestle1904 TSV | TSV (~20MB) | **CC BY 4.0** (composite; attribute) | Best single file for NT word cards |
| **Greek occurrence senses** | MACULA/MARBLE `sources/MARBLE/SDBG/sdbg-domains-glosses.xml` + TSV `ln` | XML + token tags | **CC BY 4.0** composite; attribute MACULA | Concise Louw-Nida-based labels joined by exact lemma + sense id |
| **Hebrew OT tokens + morph + lemma** | [openscriptures/morphhb](https://github.com/openscriptures/morphhb) or MACULA Hebrew TSV | OSIS XML / TSV (LFS) | **CC BY 4.0** morph; WLC PD | OSHB is already attributed in this app’s `LICENSES.md` |
| **Greek morph code → English labels** | [morphgnt/sblgnt](https://github.com/morphgnt/sblgnt) parsing legend + STEPBible TEGMC | tables | CC BY-SA / CC BY | Expand `V-FPI-3P` → future passive indicative 3pl |
| **Hebrew morph codes** | [OSHB Morphology Codes](http://openscriptures.github.io/morphhb/parsing/HebrewMorphologyCodes.html) + STEPBible TEHMC | HTML / TSV | CC BY | |
| **Lexicon gloss range (Greek)** | [Dodson-Greek-Lexicon](https://github.com/biblicalhumanities/Dodson-Greek-Lexicon) or STEPBible TBESG | CSV / TSV | check per file | Label as non-contextual |
| **Lexicon gloss range (Hebrew)** | [openscriptures/HebrewLexicon](https://github.com/openscriptures/HebrewLexicon) (BDB-based) or STEPBible TBESH | XML / TSV | CC BY | |
| **Open reverse interlinear (English)** | [Clear-Bible/Alignments](https://github.com/Clear-Bible/Alignments) `eng/BSB`, `eng/YLT` | JSON (Scripture Burrito) | **CC BY 4.0** | BSB is public domain; not ESV/NIV |
| **Rich amalgamated Greek + editions** | [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TAGNT | TSV | **CC BY 4.0** | Variants across NA/SBL/Byz/TR |
| **Hebrew amalgamated + tags** | STEPBible TAHOT | TSV | **CC BY 4.0** | Strong’s-disambiguated + morph |

**Avoid for commercial v0 without counsel**

| Source | Issue |
|--------|--------|
| STEPBible **TTESV** (ESV tags) | **CC BY-NC** — non-commercial |
| SBLGNT base text | Free to use but [SBLGNT EULA](https://sblgnt.com/license/) has conditions; MorphGNT morph is CC BY-SA |
| Commercial reverse interlinears (ESV, NASB, NIV) | Not public data |

Practical English alignment for open products: **BSB + YLT** (Clear Alignments), or **Berean glosses** already inside MACULA Greek (`gloss` column).

---

## Dataset detail

### 1. MACULA Greek (Clear / Biblica) — primary NT word table

- **Repo:** https://github.com/Clear-Bible/macula-greek  
- **File:** `Nestle1904/tsv/macula-greek-Nestle1904.tsv` (also SBLGNT TSV)  
- **Sense labels:** `sources/MARBLE/SDBG/sdbg-domains-glosses.xml`; join TSV `ln` by accent-insensitive exact `lemma + id`
- **License:** CC BY 4.0 (see `LICENSE.md` for nested sources)  
- **Programmatic shape:** one row per word; tab-separated  

**Columns (27):**  
`xml:id`, `ref`, `role`, `class`, `type`, `english`, `mandarin`, `gloss`, `text`, `after`, `lemma`, `normalized`, `strong`, `morph`, `person`, `number`, `gender`, `case`, `tense`, `voice`, `mood`, `degree`, `domain`, `ln`, `frame`, `subjref`, `referent`

**Sample (1 Cor 13:8):**

| field | value |
|-------|--------|
| ref | `1CO 13:8!8` |
| text | καταργηθήσονται |
| lemma | καταργέω |
| strong | 2673 |
| morph | V-FPI-3P |
| tense/voice/mood/person/number | future / passive / indicative / third / plural |
| gloss | they will be done away |
| ln | 13.100 (Louw-Nida domain id) |

**Maps to UI**

| UI element | Field(s) |
|------------|----------|
| Surface Greek | `text` |
| Lemma / Strong’s | `lemma`, `strong` |
| Morph chips | `class` + person/number/… or expand `morph` |
| Lexical gloss | `gloss` (Berean; contextual-ish — still not “force”) |
| Neighborhood | order by `xml:id` / `ref` |
| Context-tagged Senses outline | `ln`, `domain` + MARBLE SDBG source label |
| Frequency / concordance | group by `lemma` or `strong` |

Also includes syntax trees (`lowfat`, `nodes`) if you later want clause views.

---

### 2. MACULA Hebrew — primary OT integrated table

- **Repo:** https://github.com/Clear-Bible/macula-hebrew  
- **File:** `WLC/tsv/macula-hebrew.tsv` (**Git LFS** — clone with LFS, don’t raw-curl)  
- **Also:** lowfat / nodes XML  
- **Combines:** WLC (PD) + OSHB morph + Clear syntax + Cherith glosses (CC BY) + MARBLE senses  
- **License:** composite CC BY; see `LICENSE.md`

---

### 3. Open Scriptures Hebrew Bible (OSHB)

- **Repo:** https://github.com/openscriptures/morphhb  
- **Site:** https://hb.openscriptures.org/  
- **Format:** OSIS XML under `wlc/` — each `<w>` has `lemma`, `morph`, stable `id`  
- **License:** morph/lemma **CC BY 4.0**; WLC text PD  
- **Codes:** http://openscriptures.github.io/morphhb/parsing/HebrewMorphologyCodes.html  
- **Lexicon:** https://github.com/openscriptures/HebrewLexicon  
- **npm:** `morphhb` package exists for JSON conversion scripts  

**Minimal word record**

```text
lemma=c/m/6529  morph=HC/R/Ncmsc  id=018xz
```

Good if you already ship WLC and only need tags (this app already cites OSHB).

---

### 4. MorphGNT + SBLGNT — classic Greek morph lines

- **Repo:** https://github.com/morphgnt/sblgnt  
- **Format:** space-separated columns per book file  
- **Columns:** book/ch/v · POS · parsing · text · word · normalized · lemma  
- **License:** SBLGNT text (EULA); morph **CC BY-SA 3.0**  
- **Example:** `010101 N- ----NSF- Βίβλος Βίβλος βίβλος βίβλος`

Smaller surface than MACULA (no Strong’s, no gloss, no LN). Excellent for tests and morph-code tables.

---

### 5. Nestle 1904 (biblicalhumanities)

- **Repo:** https://github.com/biblicalhumanities/Nestle1904  
- **Also:** lowfat trees under biblicalhumanities/greek-new-testament  
- **Public domain-friendly base text** often preferred over SBLGNT for redistribution  
- MACULA Nestle1904 TSV is the ergonomic packaged form of this lineage  

---

### 6. STEPBible Data (Tyndale / STEPBible.org)

- **Repo:** https://github.com/STEPBible/STEPBible-Data  
- **License:** **CC BY 4.0** for most datasets (credit STEP Bible → stepbible.org)  
- **Exception:** **TTESV = CC BY-NC**  

| Dataset | What it is |
|---------|------------|
| **TAGNT** | Amalgamated Greek NT: words across editions, morph, disambiguated Strong’s, context-sensitive translations |
| **TAHOT** | Amalgamated Hebrew OT: WLC-based, morph, extended Strong’s, prefixes/suffixes |
| **TBESG / TBESH** | Brief Greek / Hebrew lexica keyed to extended Strong’s |
| **TFLSJ** | Full LSJ entries for Bible Greek (large) |
| **TEGMC / TEHMC** | Morphology code expansions (plain-language tables) |
| **TIPNR** | Proper names / people / places with refs |
| **TVTMS** | Versification traditions |
| **TTESV** | ESV word tags — **BY-NC only** |

**Best STEPBible use for Shepherdly:** TAGNT/TAHOT + TBESG/TBESH + TEGMC/TEHMC. Skip TTESV for commercial builds.

---

### 7. Clear Bible Alignments (reverse interlinear)

- **Repo:** https://github.com/Clear-Bible/Alignments  
- **English open pairs:**  
  - `data/eng/alignments/BSB/SBLGNT-BSB-manual.json` (+ WLCM for OT)  
  - `data/eng/alignments/YLT/...`  
- **Format:** Scripture Burrito alignment JSON  
- **License:** CC BY 4.0  
- **Use:** Translation braid / “1 Greek token → N English words” without ESV rights  

Many non-English IRV/manual alignments also present (Arabic, etc.).

---

### 8. OpenGNT / OpenHebrewBible (Eliran Wong)

- **OpenGNT:** https://github.com/eliranwong/OpenGNT  
- **OpenHebrewBible:** https://github.com/eliranwong/OpenHebrewBible  
- CSV/TSV dumps, interlinear Berean, RMAC morph dictionaries, concordance helpers  
- Useful as secondary / cross-check; verify license files per artifact  

---

### 9. Lexica (gloss range only)

| Resource | Link | Use |
|----------|------|-----|
| Dodson Greek | https://github.com/biblicalhumanities/Dodson-Greek-Lexicon | short English glosses |
| OpenScriptures Strong’s | https://github.com/openscriptures/strongs | G/H number aliases |
| OpenScriptures Hebrew Lexicon | https://github.com/openscriptures/HebrewLexicon | BDB-linked |
| UBS open dictionaries | https://github.com/ubsicap/ubs-open-license | SDBH / SDGNT extracts (CC BY-SA) |
| STEPBible TBESG/TBESH | STEPBible-Data/Lexicons | extended Strong’s briefs |

Always UI-label: **lexicon range, not contextual sense**.

---

### 10. Syntax / discourse (later than v0 word cards)

| Resource | Link | Notes |
|----------|------|-------|
| MACULA lowfat trees | macula-greek / macula-hebrew | clause structure |
| ETCBC BHSA | https://github.com/ETCBC/bhsa | gold-standard Hebrew syntax (Text-Fabric) |
| Levinsohn GNT discourse | https://github.com/biblicalhumanities/levinsohn | discourse features |
| PROIEL treebanks | https://github.com/proiel/proiel-treebank | multi-text trees |
| OpenText annotations | https://github.com/OpenText-org/context-annotation | speakers, moves |

---

### 11. Curated index

- https://github.com/jcuenod/awesome-bible-data — morph, trees, lexica, alignments  

---

## What you can compute without AI

From the tables above alone:

1. **Token card** — surface, lemma, Strong’s, morph code + expanded labels  
2. **Gloss line** — dictionary / Berean gloss, labeled non-contextual where needed  
3. **Counts** — lemma frequency in chapter / book / corpus  
4. **Local concordance** — all occurrences + morph form in book  
5. **Neighborhood** — ±k tokens by sequence id  
6. **Marks**  
   - *repeat*: same lemma within N verses  
   - *rare*: lemma count &lt; threshold in corpus  
   - *diverge*: if multiple alignments, different target content words for same source id  
7. **Alignment braid** — source token → target word spans (BSB/YLT/Berean)  
8. **Edition presence** (TAGNT) — word in NA vs TR vs Byz, etc.

Not available from word tables alone: Force / Consequence / Limits, sermon-safe wording, commentary maps.

---

## Implemented in this repo

| Piece | Path |
|-------|------|
| `TokenRecord` + dataset meta | `src/core/language/types.ts` |
| Morph code → English chips | `src/core/language/morph-labels.ts` |
| Morph meanings + kinds | `src/core/language/morph-explain.ts` |
| STEP TEGMC/TEHMC overlay (Approach A) | `src/core/language/step-morph.ts`, `data/scripture/morph/` |
| TIPNR people/places identity | `src/core/language/tipnr.ts`, `data/scripture/names/` |
| Pure MACULA Greek TSV parser | `src/core/language/macula-greek-tsv.ts` |
| MACULA/MARBLE semantic-sense join + outline | `src/core/language/greek-senses.ts` |
| Indexes / marks / neighborhood | `src/core/language/indexes.ts` |
| Tests + 1 Cor 13 fixture | `tests/macula-greek-import.test.ts` |
| TIPNR tests | `tests/tipnr.test.ts` |
| Node CLI (I/O only) | `scripts/import-macula-greek.ts` |
| TIPNR import | `scripts/import-tipnr.ts` (`npm run import:tipnr`) |
| Host package loader | `src/host/token-package-loader.ts` |
| Language margin UI | `src/renderer/components/LanguageWordsSection.tsx` |
| Renderer IPC | `window.api.language.*` (list / load / verse tokens / token card) |
| Session history / deferred options | [`docs/language-margin-history.md`](./language-margin-history.md) |

```bash
# sparse-fetch Nestle1904 TSV
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Clear-Bible/macula-greek.git /tmp/macula-greek
cd /tmp/macula-greek && git sparse-checkout set Nestle1904/tsv LICENSE.md

# import into app data (host also checks library .artifacts/scripture/packages)
cd /path/to/scripture-app
npm run import:macula-greek -- \
  --input /tmp/macula-greek/Nestle1904/tsv/macula-greek-Nestle1904.tsv \
  --out data/scripture/packages/macula-greek-nestle1904 \
  --version 24.06.17

# smoke: list packages from Node
node --import tsx -e "
import { TokenPackageLoader } from './src/host/token-package-loader.ts';
const l = new TokenPackageLoader(['data/scripture/packages']);
console.log(l.listPackages());
l.load('macula-greek-nestle1904');
console.log(l.getTokenCard('macula-greek-nestle1904', 'n46013008008')?.morphLabels);
"
```

**Loader search order:**  
1. `{library}/.artifacts/scripture/packages/{id}/`  
2. `data/scripture/packages/{id}/`  

Package folder must contain `manifest.json` with `type: "interlinear-data"` and `tokens.jsonl`.

**UI:** Living Margin **Original language** section (`LanguageWordsSection`):
- **NT** → package `macula-greek-nestle1904` (Greek)
- **OT** → package `oshb-wlc` (Hebrew, RTL chips)

```bash
# Full Hebrew OT from OSHB
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/openscriptures/morphhb.git /tmp/morphhb
cd /tmp/morphhb && git sparse-checkout set wlc

cd /path/to/scripture-app
npm run import:oshb -- \
  --input /tmp/morphhb/wlc \
  --out data/scripture/packages/oshb-wlc \
  --version 2.2
```

## Minimal ingest plan (Shepherdly-shaped)

```text
1. Download macula-greek Nestle1904 TSV + MARBLE SDBG sense-gloss XML
2. Download morphhb OSIS (or MACULA Hebrew TSV via git-lfs)
3. Download Dodson CSV + TBESH (or HebrewLexicon)
4. Download Clear Alignments eng/BSB (NT + OT)
5. Download STEPBible TEGMC + TEHMC (morph code → prose chips)
6. Normalize to internal TokenRecord via parseMaculaGreekTsv(); attach senses by exact lemma + id
7. Build indexes via buildTokenIndex()
8. Optional: load BSB alignment → AlignmentSpan(source_token_id → target_words[])
```

**Stable ids:** Prefer MACULA `xml:id` (`n46013008008`) and OSHB `id` for joins; do not invent free-text keys.

---

## License checklist (product)

| Action | Required |
|--------|----------|
| Ship MACULA / OSHB / STEPBible (BY) / Clear Alignments | Attribution in app About / LICENSES.md |
| Ship MorphGNT morph with SBL text | CC BY-SA morph + SBLGNT EULA compliance |
| Ship TTESV (ESV tags) | **No** for commercial without separate rights |
| Claim “ESV reverse interlinear” | Needs Crossway (or other) commercial agreement — not in public dumps |
| Show Berean gloss from MACULA | PD as of 2023 per MACULA license notes — still attribute stack |

---

## Quick clone commands

```bash
# NT word table (no LFS required for Nestle1904 TSV)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Clear-Bible/macula-greek.git
cd macula-greek && git sparse-checkout set Nestle1904/tsv doc LICENSE.md

# Hebrew (needs git-lfs for full TSV)
git clone --depth 1 https://github.com/openscriptures/morphhb.git

# STEPBible packages
git clone --depth 1 https://github.com/STEPBible/STEPBible-Data.git

# Open English alignments
git clone --depth 1 https://github.com/Clear-Bible/Alignments.git
```

---

## Mapping to the data-first mockup

| Mockup element | Public source |
|----------------|---------------|
| καταργηθήσονται + morph chips | MACULA Greek TSV |
| G2673 | MACULA `strong` |
| Lexicon gloss | MACULA `gloss` and/or Dodson / TBESG |
| 3 / 9 / 27 counts | index over MACULA `lemma` |
| Same lemma in book | group by lemma where book=1CO |
| Translation alignment | Clear BSB/YLT or Berean gloss columns; not ESV public |
| Marks: diverge / repeat / rare | derived rules over alignment + counts |
| Morph code → labels | MorphGNT legend or STEPBible TEGMC |

The earlier “Form / Force / Consequence / Limits” layer is **not** in these datasets.
