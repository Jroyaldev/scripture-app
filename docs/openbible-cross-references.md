# OpenBible Cross References

The app ships the complete scored OpenBible cross-reference snapshot dated 2026-07-13. The normalized artifact contains 344,799 edges from all 66 books. Lower-ranked and non-positive edges remain in the installed artifact so future ranking work can be reproduced; ordinary reader queries exclude non-positive scores and return a deliberately compact result set.

## Reader behavior

- A single verse shows the ten highest-ranked positive connections by default (the API permits 8-12).
- A selected passage aggregates the relationships of every verse and shows eight destinations by default (the API permits 6-10).
- Repeated destinations gain support from multiple source verses without losing the original OpenBible scores.
- Destination ranges remain ranges and opening one selects the complete same-chapter range.
- OpenBible results and connections inferred from the reader's notes are separate sections with separate provenance.

OpenBible describes the corpus as commonalities involving themes, words, events, or people, but it does not provide a verified relationship type on each edge. The UI therefore does not invent labels such as quotation, parallel, theme, or prophecy. Those labels require a distinct, source-backed enrichment layer before they can appear.

## Import and verification

Run:

```sh
npm run import:openbible-crossrefs -- /path/to/cross_references.zip
npm run verify:data
```

The importer accepts the official tab-separated download (directly or inside its zip), validates every canonical source and target coordinate, preserves target ranges and every integer score, rejects duplicate edges and reversed ranges, verifies all-book coverage, and records the license, snapshot date, hashes, and score totals. It writes:

- `data/cross-references/openbible.jsonl` — deterministic normalized graph plus metadata.
- `data/cross-references/openbible-doctor-report.json` — coverage, range, coordinate, uniqueness, license, snapshot, and score-preservation checks.

The committed snapshot contains five references to the source dataset's `3John.1.15`; the importer maps them explicitly to this app's canonical `3JN.1.14` coordinate and reports the mapping rather than silently dropping those rows.

## Attribution

Display as **OpenBible Cross References · CC-BY**. The full attribution is **OpenBible Cross References, CC-BY 4.0, snapshot 2026-07-13**. Do not relabel the compiled and scored dataset as simply “TSK, Public Domain.”
