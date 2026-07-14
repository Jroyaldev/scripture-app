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

## Cross-Reference Corpus

### Treasury of Scripture Knowledge (TSK)

- **Source:** Originally compiled by R.A. Torrey (1880s), public domain. Digital versions available from multiple sources including [OpenBible.info](https://www.openbible.info/labs/cross-references/) and [eBible.org](https://ebible.org).
- **License:** Public Domain (original work is pre-1928, no copyright in the United States)
- **SPDX:** N/A (public domain)
- **Attribution:** "Cross-references derived from the Treasury of Scripture Knowledge, compiled by R.A. Torrey. Public Domain."
- **Permission Flags:**
  - `bundle`: true
  - `index`: true
  - `display`: true
  - `quoteInNotes`: true
  - `export`: true
  - `syncToOwnDevices`: true

## Backbone Coordinate System

### backbone.json

- **Source:** Project-authored data. Verse counts compiled from public domain Scripture texts (KJV/WEB verse divisions for the Protestant 66-book canon).
- **License:** Apache-2.0 (part of this project)
- **Book codes:** USFM 3-letter uppercase, per the Unified Standard Format Markers specification (public standard).

## App License

- **Core app:** Apache-2.0
- **Plugin SDK/API:** MIT or Apache-2.0 (permissive, per INV-19)
