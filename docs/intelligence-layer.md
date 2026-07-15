# The Intelligence Layer — Signal Map

> Living document. Every signal, every stage, every knob — so the system stays
> understandable and tunable as it grows. If you change the pipeline, change
> this map. Companion: `tasks/B3.5-margin-retrieval-quality.md` (how we got
> here), `npm run calibrate:margin` (re-measure), `npm run eval:margin` (the
> magic gate as a regression test).
>
> **Not this document:** the Living Margin *Original language* strip (morph
> chips, STEP overlay, TIPNR people/places) is data-first word tables, not
> retrieval AI. History and deferred options:
> [`docs/language-margin-history.md`](./language-margin-history.md).

## Identity (decided 2026-07-02)

**Amplifier, not commentator.** The AI organizes, connects, and resurfaces the
user's own gathered material (their notes, their sources, their voices); it
never authors interpretation shown in the UI. Notes carry a **voice** (`mine`
or an attributed teacher/source) — voices are kept distinct end-to-end:
attribution on claims, disagreement-mapping in threads, and healing signals
that learn only from the user's own voice. Full decision log:
`tasks/B3.6-quick-note-magic.md` § Product decisions.

## Design creed

**Work backwards from magic.** Magic = the system shows the *right* thing, with
a reason a pastor can verify in one glance, and shows *nothing* when it has
nothing. Every stage below exists to serve one of those three properties. Any
proposed feature that can't name (a) the user expectation it serves and (b) the
knob that tunes it, doesn't ship.

## The two layers

```
                      ┌─ DETERMINISTIC MARGIN (no AI, always trustworthy) ─┐
 passage opened ────▶ │ anchored notes · highlights · OpenBible xrefs ·   │
                      │ backlinks · PDF source chunks                      │
                      └────────────────────────────────────────────────────┘
                      ┌─ SEMANTIC MARGIN (AI-derived, evidence-gated) ─────┐
                      │ related notes · threads · claims · overlays ·      │
                      │ suggested cross-refs                               │
                      └────────────────────────────────────────────────────┘
```

The deterministic margin never lies and needs no gating. Everything below is
about the semantic margin.

## Pipeline stages (related-notes retrieval)

One shared code path — Electron IPC, eval harness, and verify scripts all call
`runSemanticMargin` (`src/host/semantic-margin-host.ts`), which orchestrates:

### Stage 0 — Indexing (write time)
| What | Where | Notes |
|---|---|---|
| Paragraph chunking | `chunkNoteBody` in `src/core/ai/retrieval.ts` | Blank-line paragraphs; tiny fragments (<200 chars) merge forward; hard cap 1200 chars (~300 tokens). Deterministic: same body → same chunk ids. |
| Chunk embedding | `embedAllNotes` in `src/host/embeddings-sync.ts` | `title\n` prepended to every chunk (context); EmbeddingGemma-300m ONNX q8, document prompt prefix; incremental by per-chunk content hash; stale/legacy sweep. |
| Anchor extraction | `LibraryEngine` note indexing | Scripture refs typed in note bodies ("Acts 19:2") become anchors — this powers the strongest retrieval evidence AND claim-extraction eligibility. **Notes with no typed refs have no anchors.** |
| FTS5 index | `notes_fts` in `src/host/sqlite.ts` | BM25 over note body text. |

### Stage 1 — Query construction (read time)
| What | Where | Notes |
|---|---|---|
| Query embedding | `runSemanticMargin` | Raw passage text (capped 1500 chars), query prompt prefix. **The query is the bare translation text — no glosses, no theme hints.** |
| Keyword extraction | `extractKeywords` | Stopword-filtered (incl. KJV archaisms), frequency-ranked, top 24, OR-joined into FTS5. |
| Cross-ref targets | deterministic margin's ranked OpenBible list | Feeds reference evidence below. |

### Stage 2 — Three evidence channels
| Channel | Signal | Strength | Explains itself as |
|---|---|---|---|
| **Reference** | note anchored to an OpenBible cross-ref target of the passage, or elsewhere in the queried chapter | Strongest; admits regardless of dense score | "Cites Acts 8:17 — a cross-reference of this passage" / "Notes on Acts 19:6, in this chapter" |
| **Dense** | best-chunk cosine vs query embedding | Primary; subject to floors | "Closely related theme" |
| **Lexical** | BM25 rank over passage keywords | Corroborating only (softer floor) | "Strong wording overlap with this passage" |

### Stage 3 — Decision layer (`selectRelatedNotes`)
Admission: reference hit **OR** dense ≥ `denseFloor` **OR** (BM25 top-`lexicalTopN`
**AND** dense ≥ `softFloor`). Then: score-gap cutoff for semantic-only admits →
RRF fusion (rank-based, k=60) across the three channels → MMR diversity →
cap `maxResults`. **Zero results is a first-class outcome.**

### Stage 4 — Presentation
Reason chips per card (deterministic labels only), best-chunk snippet, honest
empty state, no raw percentages anywhere.

## The other semantic surfaces

| Surface | How it works today | Trust model |
|---|---|---|
| **Claims** | DeepSeek (`claims-v2`) extracts assertions from notes **anchored to the passage**; every claim must quote a note verbatim (≤15 words), string-verified; confidence derived from evidence count, model self-report ignored | Rejected-not-repaired validation; "grounded in N notes" + quote in UI |
| **Threads** | stored groupings; surfaced only when they involve a note visible for this passage | scoped, currently no in-app generator (B3 Gate 3) |
| **Suggested cross-refs** | verses that surfaced related notes cite, minus OpenBible, minus the passage itself | fully deterministic, labeled "from your notes" |
| **Overlays** | stored AI ranges for the passage | no in-app generator yet |

## Knob table (tune here, verify with calibrate + eval)

| Knob | Default | File | Effect when raised |
|---|---|---|---|
| `denseFloor` | 0.66 | `DEFAULT_RETRIEVAL_OPTIONS`, `src/core/ai/retrieval.ts` | fewer semantic-only cards, more silence |
| `softFloor` | 0.62 | same | fewer lexical-corroborated cards |
| `scoreGap` | 0.08 | same | trailing semantic admits trimmed harder |
| `maxResults` | 5 | same | margin length |
| `mmrLambda` | 0.5 | same | ↑relevance vs ↓diversity |
| `lexicalTopN` | 5 | same | how deep BM25 counts as corroboration |
| `rrfK` | 60 | same | flattens rank differences when raised |
| Chunk max/min | 1200 / 200 chars | `CHUNK_MAX_CHARS` / `CHUNK_MIN_CHARS` | bigger chunks = more context, less precision |
| Query cap | 1500 chars | `QUERY_TEXT_CAP`, `semantic-margin-host.ts` | latency vs passage coverage |
| Keyword count | 24 | `extractKeywords` | BM25 recall vs noise |
| Quote length limit | 15 words | claims-v2 prompt | evidence granularity |
| Confidence derivation | 0.5 + 0.2/quote + 0.05/ref | `deriveClaimConfidence` | claim confidence scaling |

Measured context for the floors (2026-07-02, EmbeddingGemma-300m q8, asymmetric
prefixes): unrelated passage↔chunk cosine ≈ 0.45–0.65; related ≈ 0.66–0.81.
The bands OVERLAP — floors alone can never be perfect, which is why reference
evidence bypasses them and the gap cutoff trims the boundary.

## Known blind spots (measured — see tasks/B3.6)

The evidence channels assume a *citation-rich, wordy* note-taker. Notes that
are short, colloquial, or reference-free (the most common real-world capture
style) systematically under-trigger every channel:

1. **No typed refs → no anchors → no reference evidence, and invisible to claim
   extraction** (which gathers notes by anchor overlap only).
2. **Short text → weak dense score** (a 8-word thought vs a 40-word verse range
   rarely clears 0.66) and near-zero BM25 overlap with translation wording.
3. **Raw-translation query text** misses conceptual matches: a note saying
   "why does God feel silent" shares almost no surface with Psalm 13's WEB
   wording — the model must bridge idiom, translation register, and brevity
   simultaneously.

Quantified (2026-07-02, `npm run eval:personas`): **0/13** expected
resurfacings for three simulated realistic personas; 0/13 claims-eligible;
short-note true-match cosine band 0.53–0.60 sits below the paragraph-note
floor and cannot be rescued by tuning. The fix (capture-time note enrichment:
inferred refs + themes + expansion, Derived + confirm-to-promote) and its
acceptance gate live in `tasks/B3.6-quick-note-magic.md`.
