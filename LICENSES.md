# Scripture & Data Licenses

This document records every shipped dataset with its license, source, and permission flags as required by §4.7 and M0.

## Scripture Texts

### World English Bible (WEB)

- **Source:** [https://worldenglishbible.org](https://worldenglishbible.org) / [eBible.org](https://ebible.org/web/)
- **Data source:** [TehShrike/world-english-bible](https://github.com/TehShrike/world-english-bible) (GitHub, JSON format)
- **License:** Public Domain (no copyright)
- **SPDX:** N/A (public domain)
- **Attribution:** "World English Bible (WEB). Public Domain. No copyright. Free to use, copy, and distribute."
- **Format version:** 1
- **Note:** ROM 16:25-27 (the doxology) was missing from the TehShrike source and supplemented from public domain WEB text.
- **Permission Flags:**
  - `bundle`: true
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true

### King James Version (KJV)

- **Source:** Various public domain sources; Crown Copyright expired in the UK except by Letters Patent (not enforced outside the UK for scholarly use). No copyright restrictions in the United States.
- **Data source:** [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv) (GitHub, JSON format)
- **License:** Public Domain (in the United States and most jurisdictions)
- **SPDX:** N/A (public domain)
- **Attribution:** "King James Version (KJV). Public Domain."
- **Format version:** 1
- **Permission Flags:**
  - `bundle`: true
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true

## Original Language Datasets (candidates — not bundled in M0/M1)

### SBL Greek New Testament (SBLGNT)

- **Source:** [https://sblgnt.com](https://sblgnt.com) / [Logos/SBL](https://www.sblgnt.com/license/)
- **License:** SBLGNT End User License Agreement (free for personal/academic use; redistribution in electronic form requires specific permission or use within a licensed framework)
- **SPDX:** N/A (custom EULA, not a standard SPDX license)
- **Attribution:** "The Greek New Testament: SBL Edition. Copyright 2010 Logos Bible Software and the Society of Biblical Literature. Used by permission."
- **Permission Flags (VERIFY before bundling):**
  - `bundle`: VERIFY — the SBLGNT EULA permits redistribution in certain electronic formats with attribution; requires review of current terms
  - `index`: true (personal/academic use)
  - `display`: true
  - `quoteInNotes`: true
  - `export`: VERIFY
  - `syncToOwnDevices`: VERIFY
- **Note:** The SBLGNT text itself can be freely used and quoted with attribution, but bundling the full text in a software distribution requires confirming current license terms.

### Open Scriptures Hebrew Bible (OSHB) / Westminster Leningrad Codex (WLC)

- **Source:** [https://hb.openscriptures.org](https://hb.openscriptures.org) / [GitHub](https://github.com/openscriptures/morphhb)
- **License:**
  - OSHB morphology/lemma data: CC BY 4.0
  - WLC text: described as public domain (digitization of a public domain manuscript)
- **SPDX:** CC-BY-4.0 (morphology); N/A (WLC text — public domain)
- **Attribution:** "Open Scriptures Hebrew Bible morphology data, CC BY 4.0, https://hb.openscriptures.org. Westminster Leningrad Codex text, public domain."
- **Permission Flags:**
  - `bundle`: true (CC BY 4.0 permits redistribution with attribution)
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true

### Strong’s Hebrew concise dictionary (Open Scriptures)

- **Source:** [https://github.com/openscriptures/strongs](https://github.com/openscriptures/strongs) (`hebrew/strongs-hebrew-dictionary.js`)
- **License:** CC BY-SA 3.0 (Open Scriptures JSON; underlying Strong 1894 text is public domain)
- **SPDX:** CC-BY-SA-3.0
- **Bundled as:** `data/scripture/lexicons/strongs-hebrew-gloss.json`
- **Attribution:** "Strong's Hebrew dictionary (Open Scriptures JSON, CC BY-SA 3.0), derived from James Strong 1894, public domain."
- **Use:** Short English gloss on OT language cards when OSHB tokens have a Strong’s number.

### MACULA Greek Linguistic Datasets (Clear Bible / Biblica)

- **Source:** [https://github.com/Clear-Bible/macula-greek](https://github.com/Clear-Bible/macula-greek)
- **License:** CC BY 4.0 (composite; nested sources documented in upstream `LICENSE.md`)
- **SPDX:** CC-BY-4.0
- **Attribution:** "MACULA Greek Linguistic Datasets © Biblica, Inc / Clear Bible, https://github.com/Clear-Bible/macula-greek/, CC BY 4.0."
- **Importer:** `src/core/language/macula-greek-tsv.ts` + `npm run import:macula-greek`
- **Permission Flags:**
  - `bundle`: true (with attribution)
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true
- **Note:** SBLGNT edition also requires compliance with the [SBLGNT EULA](https://sblgnt.com/license/) for the base text. Prefer Nestle 1904 TSV for redistribution-friendly packaging.

## Lexicons and Word-Card Sources

The five sources behind the word card's "Meaning", semantic-domain and classical-lexicon
blocks (fields 8, 16, 18, 19 and 21 of [`docs/step-word-card-parity.md`](./docs/step-word-card-parity.md)).
Each is separately attributed at the render site; per Law 3·3 no two are ever concatenated
into one prose string.

### UBS Dictionary of Biblical Hebrew (SDBH)

- **Source:** [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license), `dictionaries/`
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
- **SPDX:** CC-BY-SA-4.0 (full text shipped at `data/scripture/lexicons/ubs/LICENSE-CC-BY-SA-4.0.md`)
- **Bundled as:** `data/scripture/lexicons/ubs/UBSHebrewDic-v0.9.2-en.JSON` + `…LexicalDomains…` + the derived `ubs-semantic-index.json`
- **Attribution (verbatim, and the double space after "2023." is upstream):**

```text
(UBS Dictionary of Biblical Hebrew © United Bible Societies, 2023.  Adapted from Semantic Dictionary of Biblical Hebrew © 2000-2023 United Bible Societies.)
```

- **Importer:** `src/core/language/ubs-semantic-dictionary.ts` + `npm run import:ubs-dictionaries`
- **Use:** 7,932 entries / 16,224 meanings / 260,813 Scripture references / 411 semantic-domain nodes. Definitions, glosses, and the Hebrew semantic-domain tree on OT word cards.
- **ShareAlike obligation:** any dataset we derive from this and redistribute must itself be CC BY-SA 4.0. It must not be pooled into an unlabelled edge or gloss set with the CC BY sources (OpenBible, MACULA, TIPNR).
- **Rider (upstream completeness, not a licence term):** the README states SDBH is an ongoing project at roughly 90% (the shipped v0.9.2 notes say 99%) of Old Testament words — a missing word is upstream coverage, not an import defect.
- **Note:** SDBH carries **no** Louw-Nida entry code on any of its 16,224 meanings, and its bare digit domain codes collide with SDGNT's with zero label agreement (`001002` = "Regions On the Earth" in SDBH, "Regions Above the Earth" in SDGNT). The two domain trees are namespaced apart on purpose; do not merge them into one field.

### UBS Dictionary of the Greek New Testament (SDGNT)

- **Source:** [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license), `dictionaries/`
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
- **SPDX:** CC-BY-SA-4.0
- **Bundled as:** `data/scripture/lexicons/ubs/UBSGreekNTDic-v1.1-en.JSON` + `…LexicalDomains…`
- **Attribution (verbatim; it is a three-step chain — UBS 2023 ← SDGNT 2018-2023 ← Louw-Nida 1988/1989 — and all three steps are required. Contains an upstream SOFT HYPHEN, U+00AD, inside "New Testa­ment"; do not "fix" it):**

```text
(UBS Dictionary of New Testament Greek, © United Bible Societies, 2023. Adapted from Semantic Dictionary of Biblical Greek: © United Bible Societies 2018-2023, which is adapted from Greek-English Lexicon of the New Testa­ment: Based on Semantic Domains, Eds. J P Louw, Eugene Albert Nida © United Bible Societies 1988, 1989.)
```

- **Importer:** `src/core/language/ubs-semantic-dictionary.ts` + `npm run import:ubs-dictionaries`
- **Use:** 5,507 entries / 9,178 meanings / 130,923 references / 7,075 Louw-Nida codes / 738 domain nodes. Occurrence-bound Louw-Nida senses on NT word cards.
- **ShareAlike obligation:** as SDBH above. The Louw-Nida codes MACULA carries are CC BY 4.0; the SDGNT prose keyed to them is CC BY-SA 4.0. Joining them does not relicense the prose.
- **Rider (a credit the copyright line does not carry):** the exhaustive reference list is a third party's contribution, and the README says so —
  "which was created and kindly made available by the Summer Institute of Linguistics (SIL)". A render site that shows the reference lists owes SIL that sentence.
- **Note:** 22 SDGNT entry codes sit in a domain `94` that is absent from the published Louw-Nida tree (which stops at `093`); its content is an idiom bucket. Rejecting them is correct.

### Mounce Concise Greek-English Dictionary

- **Source:** [jcuenod/dictionary](https://github.com/jcuenod/dictionary) (`dictionary.txt`; byte-identical mirror at [OpenBibleSearch/dictionary-1](https://github.com/OpenBibleSearch/dictionary-1)), released for redistribution by William D. Mounce of [teknia.com](https://www.teknia.com/greek-dictionary)
- **License:** Attribution-NonCommercial. **Free for NON-COMMERCIAL, non-revenue-bearing use only.** The grant, verbatim:

```text
Released for redistribution with attribution by William D. Mounce of teknia.com. You may freely use the dictionary in non-commercial, non-revenue bearing projects.
```

  **Pericope is non-commercial and free of charge, which is the only reason this dictionary is
  usable here.** If this project ever takes revenue — paid licence, subscription, ad-supported
  build, bundled commercial distribution — this source falls out of the grant and must be
  removed from the shipped data, not merely re-credited.
- **SPDX:** N/A (custom non-commercial grant; not an OSI or SPDX licence)
- **Bundled as:** `data/scripture/lexicons/greek-short-defs/Mounce-Concise-Greek-English-Dictionary-teknia.com-NC.txt`
- **Attribution — REQUIRED, character-for-character, and the licensor's own sentence around it is "Any use of this dictionary requires the following statement made publically visible". Three lines in the source:**

```text
Mounce Concise Greek-English Dictionary
Copyright 1993 All Rights Reserved
www.teknia.com/greek-dictionary
```

  One-line form for a footer, a `title=`, or a captured note excerpt, where three lines will not fit:

```text
Mounce Concise Greek-English Dictionary Copyright 1993 All Rights Reserved www.teknia.com/greek-dictionary
```

- **Importer:** `src/core/language/greek-short-defs.ts` + `npm run import:greek-short-defs`
- **Use:** 5,626 keys / 5,389 parsed entries. The ≤25-word card gloss — plain text, zero HTML, and the string STEP itself prints in its "Meaning" block.
- **Note (parse hazard, load-bearing):** Mounce keys on **both** Goodrick-Kohlenberger and Strong's, GK first, and the two numberings agree on only 13 of 5,362 entries. The GK number is never used as a join key. Mounce's lowercase suffixes (`G32a`) are a different namespace from STEPBible's sense letters — 0 of Mounce's 121 lowercase keys appear in TBESG's dStrong set. The upstream `dictionary.json` in the same repo drops the letter and so serves ἀγγέλλω's definition under ἄγγελος' number on 121 keys; we parse `dictionary.txt` and never `dictionary.json`.

### STEPBible TBESG (Translators Brief lexicon of Extended Strongs for Greek)

- **Source:** [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data), `Lexicons/`
- **License:** Creative Commons Attribution 4.0 International
- **SPDX:** CC-BY-4.0
- **Bundled as:** `data/scripture/lexicons/greek-short-defs/TBESG-STEPBible-CC-BY.txt`
- **Attribution (verbatim from the file's own licence block, line 12; the double space after "at" is upstream):**

```text
Data created by www.STEPBible.org based on work at  Tyndale House Cambridge (CC BY 4.0)
```

- **Importer:** `src/core/language/greek-short-defs.ts` + `npm run import:greek-short-defs`
- **Use:** 11,035 keys. Column 7 `Gloss` is the only sense-distinguishing gloss we hold; column 8 `Meaning` is the deeper Abbott-Smith article.
- **RIDER — redistribution, and it applies to this repo:** the same licence block asks, in as many words:

```text
Refer others to github.com/STEPBible as the source of the data. Please do not redistribute it yourself.
```

  CC BY 4.0 **permits** redistribution, so this is a request rather than an enforceable
  condition — but it is the licensor's stated wish and we are currently shipping the raw file.
  Two further sentences from the same block bear on what we may do to it:

```text
Download the data and reformat it for your application, without changing the data
```

```text
(You MAY make changes yourself, but you should include a note of changes that can be viewed by those who use your new data)
```

  This is why the parser normalises Greek **identifiers** to NFC but leaves every prose string
  byte-identical to the source, and why the importer records its changes in the doctor report.
  **Owner decision required:** ship the raw file, or ship only the derived index and point
  readers at github.com/STEPBible.
- **Rider — attribution is not uniform across the column.** Measured over the 11,035 rows: 5,708 end `(AS)` (Abbott-Smith), 2,305 end `(ML)` (Middle Liddell), and 3,022 carry neither, which by the file's own line 78 ("Those without attribution have been added by STEPBible") is STEPBible's own scholarship. A single "Abbott-Smith" label over the column would misattribute 5,327 of 11,035 rows.

### STEPBible TFLSJ (Translators Formatted full LSJ Bible lexicon)

- **Source:** [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data), `Lexicons/`. Edited from the full Liddell-Scott-Jones 9th ed. by Tyndale House Cambridge scholars.
- **License:** Creative Commons Attribution 4.0 International
- **SPDX:** CC-BY-4.0
- **Bundled as:** `data/scripture/lexicons/lsj/TFLSJ-STEPBible-CC-BY.txt` (23,831,837 b) + `TFLSJ-extra-STEPBible-CC-BY.txt` (8,377,070 b), plus `lsj-index.json` and 12 `lsj-slices-*.json` shards
- **Attribution (verbatim, from `TFLSJ-STEPBible-CC-BY.txt` line 12):**

```text
Data created by www.STEPBible.org based on work at  Tyndale House Cambridge (CC BY 4.0)
```

- **Rider — the required line is NOT byte-identical across the two files.** `TFLSJ extra` writes it with a **single** space after "at" where `TFLSJ` and `TBESG` write **two**:

```text
Data created by www.STEPBible.org based on work at Tyndale House Cambridge (CC BY 4.0)
```

  Both are upstream. The double-space form above is the one to render (2 of the 3 STEPBible
  files we ship); this note exists so that a future byte-equality test on the extra file does
  not read as a corruption.
- **RIDER — redistribution, and it bites harder here than anywhere else in this document.** The same "Please do not redistribute it yourself" request applies (quoted in full under TBESG). It matters more for TFLSJ because **the shipped raw text IS the payload, not provenance**: `lsj-slices-*.json` stores `{file, offset, length}` byte ranges into these two `.txt` files, so the app reads LSJ prose out of them at run time. Dropping the raw files to honour the request would require re-materialising 27,368,537 characters of prose into the shards.

  **OWNER DECISION, 2026-07-26 — SETTLED. The raw files stay and the shards are NOT rebuilt.**
  The licence is CC BY 4.0, which permits redistribution; the "please do not redistribute"
  line is the licensor's preference, not a condition, and the owner is seeking honorary
  permission from STEPBible directly. **Do not "fix" this by re-materialising the prose into
  the shards** — that would be undoing a deliberate decision, and it would triple the derived
  weight to avoid an obligation that does not exist. If STEPBible ever declines, revisit;
  until then this is closed.
- **Importer:** `src/core/language/lsj.ts` + `npm run import:lsj`
- **Use:** 11,034 entries, 27,368,537 chars of formatted LSJ prose (mean 2,480), 121,856 citations, 33,592 sense markers. The classical-lexicon block on the Greek word card (parity field 18).
- **Note:** `lsj-index.json` records the upstream file names, which contain a **double space** after `TFLSJ` — the upstream URL 404s without it.

## Cross-Reference Corpus

### OpenBible Cross References

- **Source:** [OpenBible.info Cross References](https://www.openbible.info/labs/cross-references/). The compiled and scored dataset draws primarily from public-domain sources, especially the Treasury of Scripture Knowledge, and also incorporates OpenBible data.
- **License:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- **SPDX:** CC-BY-4.0
- **Attribution:** "OpenBible Cross References, CC-BY 4.0, snapshot 2026-07-13."
- **Importer:** `scripts/import-openbible-cross-references.ts` + `npm run import:openbible-crossrefs`
- **Note:** This app normalizes coordinates and ranks the supplied scores; it does not claim that the compiled dataset is simply TSK or public domain.
- **Permission Flags:**
  - `bundle`: true
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true

### UBS Parallel Passages

- **Source:** [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license), `parallel passages/ParallelPassages.xml` (336,250 b, sha256 `d43e7554556c1a1c5e2464e6b5ad8a4ab9118ada11060bf6b200abf3d0d0a394`)
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
- **SPDX:** CC-BY-SA-4.0 (full text shipped at `data/scripture/ubs/routes-parallels/LICENSE-CC-BY-SA-4.0.md`)
- **Bundled as:** `data/scripture/ubs/routes-parallels/parallel-passages.json`
- **Attribution (verbatim; the parentheses and the trailing full stop are the source's):**

```text
(UBS Parallel Passage Database, © 2023 United Bible Societies.)
```

- **Importer:** `src/core/entities/ubs-routes-parallels.ts` + `npm run import:ubs-routes-parallels`
- **Use:** 2,193 passage groups / 5,266 members / 5,012 distinct references, with **word-level alignment** (one digit per word: none/partial/full) across 93,419 word slots. Against the shipped OpenBible corpus this is 31.3% net-new passage pairs; the word alignment has no OpenBible equivalent.
- **ShareAlike obligation — this is the sharpest licence hazard in the batch.** ShareAlike is contagious and OpenBible cross-references are CC **BY** 4.0. Pooling UBS parallels and OpenBible edges into one unlabelled edge set would put the CC BY corpus under CC BY-SA by contamination. Any derived connection or edge set that includes UBS parallels is CC BY-SA 4.0 and must be labelled as such, per edge, and kept distinguishable from the OpenBible set.
- **Note (correctness gate, not licensing):** OT references are numbered in BHS, not English-Protestant. 337 of 2,788 Hebrew references sit in one of the 137 divergent chapters; 14 fail loudly and 323 are in-range integers pointing at the **wrong verse**. Divergent members are stored with `kind: "divergent"` and carry no canonical coordinates on purpose. This is open task #28.
- **Note:** the group (2,193 of them), not the pair, is the unit of scholarly judgement — 30 large groups generate 32.7% of all pairs, and the corpus includes formulaic repetition ("the word of the LORD came to me", ×39) that should not be rendered to a reader as a parallel.

## Biblical Entity Research

### STEPBible TIPNR

- **Source:** [STEPBible Data](https://github.com/STEPBible/STEPBible-Data), TIPNR proper-name records
- **License:** Creative Commons Attribution 4.0 International
- **SPDX:** CC-BY-4.0
- **Attribution:** "STEPBible TIPNR, CC BY 4.0, stepbible.org."
- **Use:** Biblical person/place identities, canonical references, translation-aware forms, grammatical relationship fields, and retained KJV edition paratext.

### OpenBible Bible Geocoding Data

- **Source:** [OpenBible Bible Geocoding Data](https://github.com/openbibleinfo/Bible-Geocoding-Data), pinned commit `7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f`
- **License:** Creative Commons Attribution 4.0 International
- **SPDX:** CC-BY-4.0
- **Attribution:** "OpenBible Bible Geocoding Data, CC BY 4.0."
- **Use:** Modern location proposals, confidence/alternatives, linked identifiers, and curated media metadata.

### Pleiades Gazetteer

- **Source:** [Pleiades Gazetteer release 4.1](https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1), 2025-05-28, commit `b6a6790f71c45e4a4ef60fce296c506f28f458bf`, DOI `10.5281/zenodo.1193921`
- **License:** Creative Commons Attribution 3.0 Unported
- **SPDX:** CC-BY-3.0
- **Attribution:** "Pleiades Gazetteer release 4.1, CC BY 3.0."
- **Use:** Ancient names, dated place assertions, geometry, place relationships, provenance, and bibliography for the 96 Pleiades identities linked by the shipped OpenBible artifact.
- **Note:** Pleiades remains separately labelled from OpenBible; source coordinates are compared and disagreements remain visible.

### Natural Earth land geometry

- **Source:** [Natural Earth](https://www.naturalearthdata.com/), version 5.1.2, 1:50m land
- **License:** Public domain
- **Attribution:** "Natural Earth. Public domain."
- **Use:** Offline entity minimap land geometry.

### Packaged place media

- **Source:** OpenBible-curated Wikimedia and archival thumbnails; exact creator, source, and license are stored per image.
- **License:** Per file: public domain, CC0, CC BY, CC BY-SA, Free Art License, or Open Government Licence only.
- **Use:** Locally packaged visual context labelled as proposed site, geographic context, associated artifact, or later reception.

### unfoldingWord® Translation Words

- **Source:** [unfoldingWord/en_tw](https://git.door43.org/unfoldingWord/en_tw) — [unfoldingword.org/utw](https://www.unfoldingword.org/utw). Shipped `en_tw.zip`, `manifest.yaml` version 89, `dublin_core.issued`/`.modified` both 2026-06-24.
- **License:** Creative Commons Attribution-ShareAlike 4.0 International (upstream `LICENSE.md` shipped at `data/scripture/names/people-prose/sources/en_tw-LICENSE.md`; `*Copyright © 2026 by unfoldingWord*`)
- **SPDX:** CC-BY-SA-4.0
- **Bundled as:** `data/scripture/names/people-prose/unfoldingword-tw.json`
- **Attribution — REQUIRED. Verbatim, lifted out of the derivative-work rider below:**

```text
The original work by unfoldingWord is available from unfoldingword.org/utw
```

- **RIDER — trademark, and it points the opposite way for modified and unmodified copies. Verbatim:**

```text
unfoldingWord® is a registered trademark of unfoldingWord. Use of the unfoldingWord name or logo requires the written permission of unfoldingWord. Under the terms of the CC BY-SA license, you may copy and redistribute this unmodified work as long as you keep the unfoldingWord® trademark intact. If you modify a copy or translate this work, thereby creating a derivative work, you must remove the unfoldingWord® trademark.
```

- **RIDER — derivative works. Verbatim:**

```text
On the derivative work, you must indicate what changes you have made and attribute the work as follows: “The original work by unfoldingWord is available from [unfoldingword.org/utw](https://www.unfoldingword.org/utw)”. You must also make your derivative work available under the same license (CC BY-SA).
```

  **How this applies to us.** We import selected files, split them at their markdown headings,
  and add a granularity scope and TIPNR entity ids; no source sentence is edited, reflowed, or
  joined to another source (`proseUnmodified: true`, and `attribution.changes` records the
  three changes we did make). The artefact is therefore best read as a **derivative**: the
  changes are declared, the attribution string above is used rather than the trademark, and the
  derived data is CC BY-SA. **Do not print the unfoldingWord® mark on our derived artefact.**
- **ShareAlike obligation:** our derived data must be available under CC BY-SA 4.0, and must not be pooled with public-domain (Hitchcock, ISBE) or CC BY (TIPNR) prose into one unlabelled block. Each `ProseBlock` carries its own `sourceId`, and the key set is asserted closed so a merged prose field cannot appear.
- **Use:** 368 records over 173 name keys and 195 entity ids, from 355 `bible/names` files plus the 13 `bible/kt` files whose name matches a TIPNR entity. Name-scoped and person-scoped biographical prose behind the name card.
- **Note (why the granularity scope exists):** 124 of the matched names are ambiguous, worst case **19 Azariahs** behind one paragraph. `individualProse()` throws rather than hand a name-level paragraph to a render site as one person's account.

### Hitchcock's Bible Names Dictionary

- **Source:** [CrossWire Sword module "Hitchcock"](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Hitchcock) version 2.0, text source CCEL, from "Hitchcock's New and Complete Analysis of the Holy Bible"
- **License:** Public Domain
- **SPDX:** N/A (public domain)
- **Bundled as:** `data/scripture/names/people-prose/hitchcock.json` (+ `sources/Hitchcock.zip`)
- **Attribution (not required by the licence; recorded and rendered anyway):**

```text
Hitchcock's Bible Names Dictionary, from "Hitchcock's New and Complete Analysis of the Holy Bible" (late 1800s). Public domain. CrossWire Sword module "Hitchcock" version 2.0, text source CCEL.
```

- **Date:** 1874 — **INFERRED.** INFERRED. The Sword module says only "published in the late 1800s" and gives no year; 1874 is the usual date given for Roswell D. Hitchcock's "New and Complete Analysis of the Holy Bible". The module's own words are kept verbatim in `about` so a reader can see we supplied the year.
- **RIDER — inside a public-domain claim, the module's own `About` field states:**

```text
It is out of copyright, so feel free to copy and distribute it.
```

```text
Some Hebrew words of uncertain meaning have been left out. (Sword `About`: the dictionary is not a complete name inventory, so a missing name is not a data defect.)
```

  So a name absent from Hitchcock is upstream incompleteness, not a failed import.
- **Importer:** `src/core/entities/people-prose.ts` + `npm run import:people-prose`
- **Use:** 2,625 entries. Etymology only, and that is a measurement not an assumption: median 20 chars, max 64, **zero** entries over 120 chars. Declared `granularity: "name-only"` — a Hitchcock gloss is a fact about the *word*, so all 1,362 sole-bearer names stay name-scoped and can never bind to an individual.

### International Standard Bible Encyclopedia (ISBE)

- **Source:** [CrossWire Sword module "ISBE"](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=ISBE) version 2.2 (2009-09-07), from the 1915 first edition, James Orr General Editor
- **License:** Public Domain
- **SPDX:** N/A (public domain)
- **Bundled as:** `data/scripture/names/people-prose/isbe.json` (+ `sources/ISBE.zip`)
- **Attribution (not required; recorded and rendered anyway):**

```text
International Standard Bible Encyclopedia (1915), James Orr, General Editor. Public domain. CrossWire Sword module "ISBE" version 2.2 (2009-09-07).
```

- **Date:** 1915 — **INFERRED.** INFERRED for the year, from the first edition's publication date, which is what the scholarship cites. The Sword module's own About field instead reads "1844-1913 ed."; those are General Editor James Orr's life dates, not an edition, and the module's literal string is kept verbatim in `about` rather than shown to a reader as a date.
- **RIDER — the shipped text is OCR-derived, and the TEI apparatus is not the 1915 book's:**

```text
Sword conf History_2.2: "corrected an OCR error, numerous minor layout improvements" — the module is an OCR-derived text that has been proofread, not a keyed transcription. Treat a surprising spelling as possible OCR residue.
```

```text
Sword conf History_2.0: "updated crossreferencing, converted to TEI" — the TEI markup and the <ref> apparatus are the module maintainers' work, not the 1915 book's.
```

- **Importer:** `src/core/entities/people-prose.ts` + `npm run import:people-prose`
- **Use:** 4,657 records from 2,591 imported entries (only those whose headword or a semicolon-separated variant matches a TIPNR entity; 6,789 topical articles were not imported). Median 405 visible chars, max 175,160. ISBE's numbered homonym rosters are the one hook that resolves individuals: **1,265 segments → 1,265 distinct persons across 481 names**, where unfoldingWord reached 0 individuals on its 124 ambiguous names.
- **Note:** `sourceEntryId` is unique only **within** a source — Hitchcock and ISBE both key Aaron as `AARON`. Block identity is the `(sourceId, sourceEntryId)` pair.

### UBS Flora, Fauna and Realia handbooks

- **Source:** [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license/tree/main/flora-fauna-realia/XML), `FLORA_1.1_en.xml` / `FAUNA_1.1_en.xml` / `REALIA_1.1_en.xml`
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
- **SPDX:** CC-BY-SA-4.0 (full text shipped at `data/scripture/ubs/flora-fauna/LICENSE-CC-BY-SA-4.0.md`)
- **Bundled as:** `data/scripture/ubs/flora-fauna/` — the three source XML, `ubs-flora-fauna-index.json`, `-anchors.json`, `-image-copyright.json`
- **Attribution — THREE separate strings, one per handbook. Each is a two-step chain (UBS 2025 adaptation of a named monograph) and both halves are required. A handbook shown on screen owes its own line, not a generic UBS credit. Verbatim (the double space after "2025." in the FLORA and REALIA lines is upstream):**

```text
Animals in the Bible © United Bible Societies, 2025. Adapted from: All Creatures Great and Small: Living Things in the Bible, by Edward R. Hope © 2005 United Bible Societies.
```

```text
Plants and Trees in the Bible © United Bible Societies, 2025.  Adapted from: Each According to its Kind: Plants and Trees in the Bible, by Robert Koops © 2012 United Bible Societies.
```

```text
Human-made Things in the Bible © United Bible Societies, 2025.  Adapted from: The Works of Their Hands: Man-made Things in the Bible, by Ray Pritz © 2009 United Bible Societies.
```

- **Importer:** `src/core/entities/ubs-flora-fauna.ts` + `npm run import:ubs-flora-fauna`
- **Use:** 762 entries / 22,244 references / 19,786 verse anchors. Plant, animal and artefact identification behind the entity and word cards.
- **ShareAlike obligation:** derived data (the index, the anchors) is CC BY-SA 4.0 on redistribution, and must stay labelled apart from the CC BY anchor and cross-reference sets.
- **IMAGE COPYRIGHT IS PER IMAGE. A blanket UBS credit would be FALSE for most plates.** Measured over the 754 plate records: **380 distinct copyright strings**, 347 distinct holders, and only **104 of 754 (13.8%)** credit UBS at all — 65 name United Bible Societies, 39 write a bare "UBS". A blanket UBS line would therefore misattribute **650 of 754 plates**. The largest groups are:
  - `Image generated by ChatGPT using OpenAI technology` × 79
  - `Pixabay` × 71
  - `© Ray Pritz by United Bible Societies` × 31
  - `Ray Pritz (UBS)` × 28
  - `© Deutsche Bibelgesellschaft, Stuttgart by United Bible Societies` × 24
  - `Gary Todd, Israel Museum, CC0, via Wikimedia Commons` × 20
  Named examples of the shape a render site must handle: `Ray Pritz (UBS)` (×28) and `Olivier BEZES (Wikimedia Commons)` (×1). Ray Pritz alone appears in **four** spellings, one with an unclosed parenthesis (`© Ray Pritz (UBS`) — normalised for counting, kept raw for display. 80 plates are machine-generated (`Image generated by ChatGPT using OpenAI technology`) and **14 are unattributable** (8 empty, 6 "Source unknown"). Many strings carry their own per-image CC rider — CC0, CC BY 2.0, CC BY-SA 3.0 — narrower or wider than the handbook's CC BY-SA 4.0. **Display the raw string; never substitute a house credit.**
- **NO IMAGES ARE CURRENTLY SHIPPED.** The three archives total 2,390,781,216 bytes (Fauna 391,931,013 / Flora 369,165,143 / Realia 1,629,685,060) and were deliberately not downloaded; a test asserts no image extension exists in the output directory. The image-copyright artefact above is metadata only.
- **RIDER — the image attribution the README defers to a PDF we do not ship:**

```text
See this information in the PDF files with copyright information.
```

  `flora images-copyright.pdf` (102,566 b) and `fauna images-copyright.pdf` (103,862 b) exist upstream; **there is no REALIA copyright PDF at all**, and REALIA has the largest plate group (392), resting on the in-XML `Copyright` element alone. Neither PDF is in this repo. Not needed for the text and reference data we import — **required before any plate is displayed.**
- **Note:** MARBLE book `112` (29 Greek references) is unidentified and deliberately left unnamed rather than guessed.

### UBS Bible Routes (Leen Ritmeyer)

- **Source:** [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license), `ubs-bible-routes/` — 179 GeoJSON + 179 SVG
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
- **SPDX:** CC-BY-SA-4.0
- **Bundled as:** `data/scripture/ubs/routes-parallels/routes.json`
- **Attribution (verbatim; terse, but this is the whole of what the README asserts as the copyright line):**

```text
(© United Bible Societies 2023)
```

- **A SECOND, SEPARATE CREDIT — the cartographer. This is a naming obligation the licence text does not cover, which is exactly why it is easy to drop. Verbatim, and it must travel with the copyright line:**

```text
These routes are part of a collection of data created for UBS by Dr. Leen Ritmeyer.
```

- **Importer:** `src/core/entities/ubs-routes-parallels.ts` + `npm run import:ubs-routes-parallels`
- **Use:** 508 LineString features / 23,951 vertices. WGS 84 lon/lat (no CRS declared → RFC 7946 default, confirmed by coordinate range). Route overlays for the entity map.
- **ShareAlike obligation:** as above. Route geometry must not be merged into the CC BY Pleiades/OpenBible geometry set without a per-feature licence label.
- **Note (what this dataset cannot do):** **zero** of the 508 features and 23,951 vertices carry a place identifier — the only `properties` key anywhere is `name`, 3 times, valued `"Overlay (Copy)"` (an Illustrator layer label). There are no Point features, so no discrete waypoints. Coordinate proximity fails as identification: 474 of the 602 endpoints with a place within 2 km have two or more candidates. Only 7 of 179 filenames carry a scripture reference.
- **Note:** `metadata.csv` upstream is tab-separated despite its extension, has no header, and indexes *map images* in the 2.4 GB MARBLE image set — it is not a route index and carries no scripture reference. The paired SVGs are derived crops with no geometry the GeoJSON lacks and **no record anywhere of their position on the globe**; they were analysed and not imported.

## Backbone Coordinate System

### backbone.json

- **Source:** Project-authored data. Verse counts compiled from public domain Scripture texts (KJV/WEB verse divisions for the Protestant 66-book canon).
- **License:** Apache-2.0 (part of this project)
- **Book codes:** USFM 3-letter uppercase, per the Unified Standard Format Markers specification (public standard).

## ShareAlike (CC BY-SA) obligations — read before pooling any dataset

**In plain terms, first.** "Attribution" (CC BY) means: use it, credit it, done — whatever you
build with it stays yours to license as you like. "ShareAlike" (CC BY-SA) adds one condition:
anything you *build out of it* has to carry the same licence. So the danger is never in
*showing* two datasets together — it is in *merging* them into one new file. Display two
corpora side by side and nothing happens. Combine them into a single derived dataset and the
whole combined thing, including the permissively-licensed half and your own work inside it,
inherits ShareAlike.

**Six** shipped sources are **CC BY-SA 4.0**, which is stricter than every licence this
document carried before this batch. ShareAlike is contagious: a derived dataset that mixes in
any of these is itself CC BY-SA on redistribution.

| source | section |
|---|---|
| UBS Dictionary of Biblical Hebrew (SDBH) | [Lexicons](#ubs-dictionary-of-biblical-hebrew-sdbh) |
| UBS Dictionary of the Greek New Testament (SDGNT) | [Lexicons](#ubs-dictionary-of-the-greek-new-testament-sdgnt) |
| unfoldingWord® Translation Words | [Biblical Entity Research](#unfoldingword-translation-words) |
| UBS Flora, Fauna and Realia handbooks | [Biblical Entity Research](#ubs-flora-fauna-and-realia-handbooks) |
| UBS Bible Routes | [Biblical Entity Research](#ubs-bible-routes-leen-ritmeyer) |
| UBS Parallel Passages | [Cross-Reference Corpus](#ubs-parallel-passages) |

Licence text, verbatim, from the shield sentence at the top of every UBS README:

```text
This work is licensed under a
[Creative Commons Attribution-ShareAlike 4.0 International License][cc-by-sa].
```

**Three rules that follow from it.**

1. **Never pool a BY-SA source with a BY source into one unlabelled set.** The concrete live
   hazard is cross-references: OpenBible is CC BY 4.0, UBS Parallel Passages is CC BY-SA 4.0.
   One merged edge list relicenses the OpenBible corpus by contamination.
2. **Per-record licence labels, not a document-level footnote.** Every artefact in this batch
   carries its `sourceId` and its own `attribution` object for exactly this reason.
3. **A derived artefact we redistribute inherits BY-SA.** That includes
   `ubs-semantic-index.json`, `ubs-flora-fauna-index.json`, `-anchors.json`,
   `parallel-passages.json`, `routes.json`, and `unfoldingword-tw.json`.

The four CC **BY** 4.0 sources added in the same batch — STEPBible TBESG, STEPBible TFLSJ,
and (via TIPNR) the name joins — carry no ShareAlike term, but TBESG and TFLSJ carry their own
redistribution **request**; see their sections.

## App License

- **Core app:** Apache-2.0
- **Plugin SDK/API:** MIT or Apache-2.0 (permissive, per INV-19)
