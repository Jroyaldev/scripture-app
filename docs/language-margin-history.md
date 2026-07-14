# Language margin — history, decisions, and future options

> Living document. Captures product and technical context from the 2026-07
> language-margin work so a future session can resume without replaying the
> whole conversation.
>
> Companion docs:
>
> - `docs/original-language-data-sources.md` — public datasets & licenses
> - `docs/intelligence-layer.md` — AI / notes margin (separate from word data)
> - `data/scripture/names/README.md` — TIPNR import notes
> - Mockups: `docs/living-margin-language-mockup.html` (+ `.png`)

**Last updated:** 2026-07-14 (Rendering Orbit + Syntax Art)

---

## 1. What this layer is for

The Living Margin **Original language** strip answers:

> What does *this word* do in *this verse* — form, gloss, and (when a name)
> *which* person or place — without inventing pastoral commentary.

It is **data-first**: chips and cards come from packaged tables (MACULA,
OSHB, STEPBible TEGMC/TEHMC, TIPNR). It is **not** the AI semantic margin
(notes, claims, retrieval). Do not merge those pipelines.

**Creed (shared with intelligence layer):** amplifier, not commentator.
Grammar notes stay descriptive. Name cards use TIPNR briefs, attributed,
not model-generated theology.

---

## 2. Conversation arc (condensed)

Rough chronological product path that led here:

1. **UX audit** of the reading app (suggest-only first).
2. **Shell UX:** mini-toolbar, reading comfort, sidebar IA, margin polish,
   passage recents/picker, note capture.
3. **Morph expanders:** pastor-readable chips + progressive open notes
   (labels → plain-English meanings).
4. **STEP overlay (Approach A):** TEGMC/TEHMC prose *alongside* our chips —
   never replace the chip row.
5. **OT STEP coverage:** Hebrew normalize + TEHMC load + composite re-prefix.
6. **Stability fixes:** ambient vs pin desync; palette mousedown clearing pin
   when clicking lemmas (false jump to Acts 19:10).
7. **“What after STEP?”** — options listed; user chose **people/places**,
   **not** translation braid.
8. **TIPNR identity layer:** individualised names (Baptist ≠ Apostle), full
   corpus import, UI name cards, prose cleanup, machine-id humanization
   (`Olives_Mount` → Mount of Olives).

That is the decision spine. Details below.

---

## 3. Layers built (current stack)

Think of three stacked concerns on one token card:

```text
┌─────────────────────────────────────────────────────────────┐
│  Surface + gloss                                            │
├─────────────────────────────────────────────────────────────┤
│  Morph chips (our parse)  ▾  meanings + raw code            │  form
│  STEP optional: phrase / explanation (TEGMC · TEHMC)        │  form prose
├─────────────────────────────────────────────────────────────┤
│  TIPNR card (if proper name): person/place identity         │  who / where
│    brief · short · Strong’s · ref count · other refs        │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Role | Primary code / data |
|-------|------|---------------------|
| **Tokens** | Word in verse: surface, lemma, Strong’s, morph | MACULA Greek / OSHB packages via `TokenPackageLoader` |
| **Morph chips** | Ordered English labels + meanings | `morph-labels.ts`, `hebrew-morph-labels.ts`, `morph-explain.ts` |
| **STEP overlay** | Approach A — extra prose table lookup by morph code | `step-morph.ts`, `data/scripture/morph/TEGMC*`, `TEHMC*` |
| **TIPNR identity** | *Which* individual/place for proper names | `tipnr.ts`, `data/scripture/names/tipnr-index.json` |
| **Rendering Orbit** | How this lemma is glossed across the corpus (circular spectrum) | `rendering-orbit.ts`, MACULA package glosses |
| **Syntax Art** | MACULA sentence tree as interactive SVG | `syntax-tree.ts`, `data/scripture/syntax/macula-greek-nestle1904/` |

### 3.1 Morph expanders

- **Closed:** POS → stem (Hebrew) → tense/aspect → voice → mood → person →
  number → gender → case… Prefer ≤5 chips + optional Strong’s id chip.
- **Open:** one line per label with plain meaning; raw morph code last,
  de-emphasized.
- **Non-goals for that phase:** domain pills, syntax trees, “Form / Force /
  Consequence” editorial cards, translation braid.

### 3.2 STEP — Approach A (chosen)

| Approach | Meaning | Decision |
|----------|---------|----------|
| **A** | Keep our chips; STEP is progressive overlay | **Shipped** |
| B | Replace chip meanings with STEP only | Rejected (loses control of label set) |
| C | Merge into one hybrid parser | Deferred (high cost, dual maintenance) |

**Why A:** MACULA/OSHB codes and STEP tables are different systems. Our
parsers own labels; STEP owns rich stock phrases for audit and pastor-
readable expansion. Offline compare scripts remain useful:
`scripts/compare-step-morph.ts`, `scripts/audit-step-coverage.ts`.

**Hebrew note:** composite codes need re-prefix (e.g. segments like
`HC/Ncmpc` → last segment treated as `HNcmpc`) so TEHMC hits; proper `HNp`
may use a deterministic stub when STEP has no row.

### 3.3 TIPNR — people / places

- **Source:** STEPBible TIPNR (CC BY 4.0) — *Translators Individualised Proper
  Names with all References*.
- **Scale (reimport 2026-07-14):** ~**4,260** entities — **3,143** person,
  **1,003** place, **114** other; ~13k `byRef` verse keys; index ~3 MB.
- **UI:** name card in `LanguageWordsSection` when token looks proper
  (`tokenLooksLikeProperName`: `HNp`, Greek proper morph, `wordType` proper…).
- **Resolution order (critical):**
  1. **verse ∩ Strong** (best — John at Mat 3:1 → Baptist, Mat 4:21 → Apostle)
  2. **Strong (+ name hint)** when verse has unrelated entities or refs incomplete
  3. **verse only** when no Strong
- **Never** resolve people by bare Strong’s alone as the *primary* story —
  G2491 is a bucket of Johns.
- **Display:** machine ids with `_` humanized (`Olives_Mount` → Mount of
  Olives); `@Brief` / `@Short` strip TIPNR `<ref>` / `<strong>` markup.

Import:

```bash
npm run import:tipnr
# reads data/scripture/names/TIPNR-STEPBible-CC-BY.txt
# writes data/scripture/names/tipnr-index.json
```

Main process loads index at startup (log: `TIPNR names index: N entities`).

---

## 4. Product decisions (freeze list)

Recorded so future work does not quietly reverse them:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| STEP integration | Approach A overlay | Control + STEP richness without dual parser |
| After STEP next step | **TIPNR people/places** | User: skip translation differ for now |
| Translation braid | **Deferred** | Valuable; heavier data + UX; not blocking identity |
| Names vs lemmas | Identity layer separate from Strong’s gloss | Same Strong ≠ same person |
| AI in language strip | No generative theology on morph/name cards | Data-first; AI stays on notes margin |
| Attribution | Show source on cards (STEPBible / TIPNR / CC BY) | License + trust |
| Ambient reading vs study pin | Pin freezes verse while studying margin | Avoid STEP/lemma click remount desync |
| Palette document mousedown | Exclude `.living-margin` | Prevent pin clear → wrong verse |

---

## 5. Bugs that encode design knowledge

Worth keeping when changing margin interaction:

1. **Lemma click → always verse 10 (Acts 19):** document-level mousedown for
   the highlight palette cleared the study pin. Fix: ignore events inside
   `.living-margin`.
2. **STEP open then desync:** ambient IntersectionObserver remount closed
   expanders. Fix: freeze ambient while margin pointer / study-lock engaged.
3. **OT STEP silent:** TEHMC not loaded / Hebrew code normalize wrong.
   Fix: load TEHMC, re-prefix composites, show STEP UI when available.
4. **Jesus / Jerusalem mis-resolve:** byRef truncated at 300; resolve fell
   through to unrelated names at verse. Fix: full ref lists + prefer Strong
   when verse∩Strong empty.
5. **Raw TIPNR markup in UI:** `@Short` not cleaned. Fix: `cleanTipnrProse`
   at import.
6. **`Olives_Mount` in title:** machine id shown raw. Fix: pretty display
   name at import + UI fallback.

---

## 6. Key paths (orientation)

| Concern | Path |
|---------|------|
| Morph explain / kinds | `src/core/language/morph-explain.ts` |
| STEP tables | `src/core/language/step-morph.ts` |
| TIPNR resolve | `src/core/language/tipnr.ts` |
| Token card assembly | `src/host/token-package-loader.ts` |
| Language UI | `src/renderer/components/LanguageWordsSection.tsx` |
| Styles (name cards, chips) | `src/renderer/styles.css` (`.lang-*`) |
| Electron load TIPNR/STEP | `src/electron/main.ts` |
| TIPNR import | `scripts/import-tipnr.ts` |
| TIPNR tests | `tests/tipnr.test.ts` |
| Morph data | `data/scripture/morph/` |
| Names data | `data/scripture/names/` |
| Greek / Hebrew packages | `data/scripture/packages/` |

Representative commits (branch history may include more polish):

- Language margin: morph expanders, STEP overlay, UX polish  
- TIPNR v1 individualised names  
- Full TIPNR coverage + safer resolve  
- Prose markup strip  
- Machine-id humanization (`Olives_Mount`)

---

## 7. Future options (menu, not roadmap mandate)

When resuming language work, pick deliberately. Order below is **suggested
priority**, not committed backlog.

### 7.1 Translation braid / reverse interlinear *(partially superseded)*

- **Shipped instead (v1):** **Rendering Orbit** — circular corpus gloss map
  from MACULA Berean glosses (open data). Product name intentionally not
  “translation ring” (Logos feature name). See §3 and UI `RenderingOrbitView`.
- **Still open:** true reverse interlinear braid against BSB/YLT Alignments
  (Clear Bible, CC BY); multi-version segment sizes; English→lemma orbit.
- Avoid TTESV (ESV) for commercial (BY-NC).

### 7.1b Syntax Art *(shipped NT Greek)*

- **Shipped:** MACULA Nestle1904 node trees → compact JSON → interactive SVG
  (“Syntax art”) for all NT books. Import: `npm run import:macula-syntax`.
- **Still open:** Hebrew MACULA trees; collapsed “simple” view; click node →
  highlight verse words; full-width panel mode.

### 7.2 Lexicon depth

- STEPBible **TBESG / TBESH** (extended Strong’s briefs).
- Dodson / OpenScriptures Hebrew lexicon for range of meaning.
- Label glosses carefully: **dictionary range ≠ contextual sense**.

### 7.3 Name-card UX polish

- Clickable other-refs → navigate passage.
- Quieter “Also at this Strong’s” when alternatives are noise.
- Optional maps link for places (TIPNR embeds Google/palopenmaps URLs in
  source — not yet surfaced).
- Gender / role chips if desired from TIPNR fields.

### 7.4 Sense / domain (careful)

- MACULA `domain` / Louw-Nida fields exist on Greek tokens.
- Risk: looks like “the” meaning. Only ship with strong non-theological
  framing and progressive disclosure.

### 7.5 Edition awareness (TAGNT / TAHOT)

- “This word form appears in NA / Byz / TR…” for power users.
- Heavy tables; optional advanced mode.

### 7.6 Editorial pastoral frames *(explicit earlier non-goal)*

- Form / Force / Consequence style cards.
- Requires either curated content or AI — clashes with data-first creed
  unless carefully gated as *user-owned* or *attributed teacher* material.

### 7.7 Outside language (product ledger)

If language work pauses, the broader app still has:

- B3.6 quick-note magic / enrichment  
- B4 rebuild story, C1 revision safety, C2 sync  
- See `docs/intelligence-layer.md` and `tasks/*`

---

## 8. How to re-enter a session (checklist)

```text
1. Skim this doc §§2–4 (arc + freeze decisions).
2. Confirm data present:
     data/scripture/morph/TEGMC* TEHMC*
     data/scripture/names/tipnr-index.json
     data/scripture/packages/macula-greek-nestle1904
     data/scripture/packages/oshb-wlc
3. npm run import:tipnr   # if raw TIPNR changed
4. npm test -- --test-name-pattern='TIPNR|morph|STEP|TokenPackage'
5. Rebuild Electron; log should show STEP codes + TIPNR entity count.
6. Smoke: Mat 3:1 John (Baptist); Mat 4:21 John (Apostle);
   Act 1:12 Mount of Olives; Gen 1:1 Hebrew STEP open.
```

When proposing a new language feature, state:

1. **Which layer** (form / STEP prose / identity / braid / lexicon)?  
2. **Which freeze decision** it respects or needs to overturn?  
3. **Data source + license** (no silent TTESV).  
4. **Success criterion** a pastor can verify without trusting the model.

---

## 9. Attribution reminder

Ship with visible credit where data is shown:

- STEPBible.org — TEGMC, TEHMC, TIPNR (CC BY 4.0)  
- Clear Bible / MACULA — Greek tokens (CC BY 4.0)  
- Open Scriptures / OSHB — Hebrew morph (CC BY 4.0); WLC public domain  

Product license notes: `LICENSES.md`. Dataset inventory:
`docs/original-language-data-sources.md`.

---

## 10. Open questions (intentionally unresolved)

Recorded so they stay optional, not forgotten:

- Should name cards open by default on proper names, or stay progressive?  
- Should `other` TIPNR kinds (divine titles, etc.) get a distinct treatment?  
- When verse has many names, is “Also at this Strong’s” the right alt UI?  
- Braid first vs lexicon first when user reopens language work?  
- Any MACULA Hebrew upgrade path vs stay on OSHB packages?

---

*End of living history. Append dated bullets when major language-margin
decisions land; prefer short decision tables over long narrative.*
