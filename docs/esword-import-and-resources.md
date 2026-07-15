# e-Sword module import + public-domain resource shortlist

> Living document. Plan for "mutating" e-Sword modules into Margin packages,
> and a curated shortlist from biblesupport.com's most-popular downloads
> (reviewed 2026-07-14). Companions: `docs/original-language-data-sources.md`,
> `docs/intelligence-layer.md` (voices/attribution model), STATUS.md M4.

## Why e-Sword modules are the right substrate

- **Modern e-Sword files are plain SQLite** (`.bblx` bibles, `.cmtx`
  commentaries, `.dctx` dictionaries, `.lexx`/`.lexi` lexicons, `.topx` topics,
  `.refx` cross-refs). Scripts use Node’s built-in `node:sqlite` (no
  better-sqlite3 ABI dance for importers).
- **Verse-keyed rows.** Bibles/commentaries key on KJV versification with
  book numbers 1–66 → maps 1:1 onto our backbone / `bref` model.
- **Content cells are RTF** (occasionally HTML in newer modules). Converter:
  `src/core/importer/rtf.ts` (codepage `\'hh`, `\uN?`, `\super` Strong’s,
  light HTML branch).
- **Licensing stays clean via an importer, not bundling.** biblesupport.com
  hosts user-created modules; the texts are mostly public domain but some
  modern ones (Guzik, Utley) are copyrighted-but-freely-distributed. If Margin
  ships an *import tool* and the user supplies the file, we never redistribute
  anything. Package manifests already carry license flags + Doctor refusal —
  mark `public-domain` vs `freeware-imported`.
- Watch out: some downloads are `.exe` self-installers wrapping the module
  (e.g. Hebraic Roots Bible) — the importer should also accept the inner file
  extracted from the archive. Pre-2009 formats (`.bbl`, `.cmt`) are Microsoft
  Access — not worth supporting; nearly everything has a SQLite re-release.
- **Extensions are case-insensitive** (`.BBLX` == `.bblx`).

## How each type lands in Margin (fit with "amplifier, not commentator")

| e-Sword type | Margin destination | Notes |
|---|---|---|
| Bible (`.bblx` / `.bbli`) | Scripture package (same shape as WEB/KJV) | `npm run import:esword-bible` → `data/scripture/text/{id}/` + manifest. |
| Commentary (`.cmtx`) | **Attributed voice** in the margin | Not built yet. |
| Dictionary (`.dctx`) | Language-margin definition pane (Strong’s-keyed) | Next after YLT. |
| Lexicon (`.lexi`) | Same pane; HTML branch | BDB+ is HTML + UTF-16 DB (node:sqlite handles). |
| Cross-refs (`.refx`) | Merge/compare against OpenBible base graph | Low priority. |
| MySword (`.dct.mybible`) | Deprioritized | Headword-keyed, not Strong’s. |

## Handoff inventory (`~/Downloads`, 2026-07-14)

All verified SQLite. Two schema families: e-Sword + one MySword outlier.
Book numbers 1–66 KJV order; full Bibles = **31,102** rows. Our backbone is
**31,074** (short on 1SA 23, JOB 41–42, 1CO 16) — importer Doctor reports the
delta; packages still write every module verse (UI reads `chapterData.verses`).

### Bibles → scripture-package lane

| File | Rows | Notes | Status |
|---|---|---|---|
| `YLT (1898).bbli` | 31,102 | Plain + light `<i>` markup; zero RTF. **Start here.** PD. | **Imported** → `ylt` |
| `AKJV-Red Letter.BBLX` | 31,102 | RTF red-letter (`\cf`). Strip color for package; optional red span later. | Pending |
| `AKJV+2.bblx` | 31,102 | RTF with `\super H####` / `G####`. Capture word→Strong’s → reverse-ring fuel. | **Imported** → `akjv-strongs` + `alignments.jsonl` |

### Lexicons → language-margin definition pane (Topic = `G####` / `H####`)

| File | Entries | Format | Status |
|---|---|---|---|
| `StrongsPlus.dctx` | 14,197 | RTF, UTF-16 DB | **Imported** → `strongs-plus.json` (Definition head) |
| `Thayers Unabridged.dctx` | 5,521 G | RTF + CP1253 Greek | **Imported** → `thayer.json` (deeper, Greek) |
| `bdb-kjv.dctx` | 8,674 H | RTF; `senses:[{n,text}]` preserved | **Imported** → `bdb-kjv.json` (deeper, Hebrew) |
| `BDB+.lexi` | 8,084 | **HTML** (`<heb>`, `<sub>`); Marvel.bible | Deferred |
| `SEC.dct.mybible` | 39,380 | MySword; headword-keyed HTML | **Skip** |

### Berean first-party (no e-Sword)

| Asset | Role |
|---|---|
| `bsb_usfm.zip` | Preferred package build source (CC0) |
| `bsb_tables.tsv` (~85 MB) | Word-level Greek/Hebrew↔English + Strong’s → reverse ring |
| `bsb_concordance.xlsx` | “See all uses” |
| https://berean.bible/licensing.htm | Manifest license text |

Also available: `bsb.txt`, `bsb.xlsx`, `bsb.docx`, `bsb.epub`, `bsb_usj.zip`, `bsb_usx.zip`.

## Pipeline status

### Done
1. **RTF/HTML converter** — `src/core/importer/rtf.ts`
2. **e-Sword SQLite reader + Doctor** — `src/core/importer/esword.ts`
3. **Bible importer** — `npm run import:esword-bible`
4. **YLT package** — `ylt` (31,102 / 0 empty)
5. **Backbone bug fixed (2026-07-14)** — short counts on 1SA 23 / JOB 41–42 / 1CO 16
   truncated WEB+KJV *text*, not just labels. Backbone → classic KJV 31,102;
   WEB/KJV rebuilt; regression in `tests/scripture-packages.test.ts`.
6. **StrongsPlus** — `npm run import:esword-dict` → `data/scripture/lexicons/strongs-plus.json`
   (14,197 keys). Definition expander on word card (`LanguageWordsSection`).
7. **AKJV+2** — `akjv-strongs` package + `alignments.jsonl` (31,100 verses with Strong’s pairs)

### Order (handoff)
1. ~~YLT package~~ ✓  
2. ~~StrongsPlus pane~~ ✓  
3. ~~Thayer + bdb-kjv~~ ✓ (layered under single Definition expander)  
4. ~~AKJV+2 with `--alignments`~~ ✓  
5. BDB+ (HTML branch) — deferred (marginal over bdb-kjv)  
6. Skip SEC  
7. ~~BSB USFM package + bsb_tables alignments~~ ✓ (default reading translation)
8. ~~Reverse ring~~ ✓ — `npm run build:reverse-index -- --all` → `reverse-index.json`;
   one orbit + mode pills (In English · Behind this word · Senses); Hebrew lemmas
   from strongs-hebrew-gloss; same-testament first; two-step activate; cross-testament
   Strong's peek when no verse token.

### Commands

```bash
# YLT (already run)
npm run import:esword-bible -- \
  --input ~/Downloads/"YLT (1898).bbli" \
  --id ylt \
  --name "Young's Literal Translation (1898)" \
  --mode plain \
  --attribution "Young's Literal Translation (1898). Public domain. Robert Young."

# AKJV+2 with Strong's alignment capture (next bible step)
npm run import:esword-bible -- \
  --input ~/Downloads/AKJV+2.bblx \
  --id akjv-strongs \
  --name "American King James + Strong's" \
  --mode rtf \
  --alignments

# Doctor only
npm run import:esword-bible -- --input ~/Downloads/"YLT (1898).bbli" --id ylt --dry-run
```

### Tests
`tests/esword-rtf.test.ts` — plain strip, Strong’s capture, codepage/unicode, YLT italics.

## Shortlist from the most-popular list (strategic)

### Bibles
- **Berean Standard Bible (BSB)** — first-party USFM, not e-Sword: modern PD English.
- **YLT** — literal-comparison lane ✓ imported.
- **AKJV** — readability modernization + Strong’s module for reverse ring.
- **Skip** Hebrew Study Bible / Marvel interlinears — OSHB + MACULA already better.

### Commentaries (later — attributed voices)
Biblical Illustrator, Pulpit, MacLaren, Calvin, Lange, Meyer, Alford; Guzik/Utley import-only.

### Language tools
StrongsPlus → Thayer → BDB (this stack multiplies Orbit); LSJ / MM later.

## Importer sketch (full catalog)

1. `npm run import:esword-bible -- path` ✓  
2. `npm run import:esword-dict -- path` (next) → Strong’s-keyed JSON for definition pane  
3. RTF→markdown for commentaries → attributed voice chunks  
4. Doctor: row count vs 31,102, empty-entry rate, license flag  

## Sequencing

1. ~~RTF converter + `.bblx` bible import (YLT)~~ ✓  
2. StrongsPlus → language margin definition pane  
3. Thayer + bdb-kjv  
4. AKJV+2 alignments + BSB USFM package + `bsb_tables` reverse ring  
5. `.cmtx` attributed voices (Illustrator / Pulpit)
