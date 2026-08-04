# Director evidence baseline

This is the reproducible baseline for the `/magic` editorial-video director. It measures saved evidence only. It performs no search, provider, or model call.

Run it from the repository root:

```sh
node lab/tour-lab/audit-director-runs.mjs
node lab/tour-lab/audit-director-runs.mjs --json
```

The analyzer scans every JSON record in `lab/tour-lab/director-runs/` in filename order. Supported records pass through the current evidence reader and contract, including deterministic v1 read-time migration. The deliberately superseded policy-2 calibration remains immutable and is measured from its raw result under an explicit `previous-policy-calibration` label. The command exits nonzero when fewer than 20 records are auditable.

## Measurement definitions

- A **visible beat** is a retained artifact that survives the authoritative wide-screen projection. Accepted but focus-masked or same-slot-superseded beats do not count as visible movement.
- **Opening blank** is time from clip start to the first visible component.
- **Maximum entrance gap** includes the opening and closing boundaries.
- **Maximum internal blank** is the largest component-free interval after applying each artifact's configured dwell.
- **Closing blank** begins when the final component's dwell ends, not merely when it enters.
- **Active coverage** is the union of visible component dwell intervals divided by clip duration. The base Scripture/editorial stage may remain visible beneath it.
- **Same-family run** groups term, caveat, aside, and footnote as editorial cards; allusion, compare, and chain as Scripture relations; group as Scripture loom; and highlight as focus.
- Proposal and rejection evidence is unavailable for migrated v1 records because v1 never recorded it. The analyzer reports an em dash rather than reconstructing it.

## Audited corpus: 40/40 records

The provider-free audit currently accepts all 40 saved records: 19 migrated v1
records, one deliberately superseded D17 calibration, 20 current-policy
records, and no unauditable record. The first 32 records are the historical baseline: the
current D17 calibration, five Romans long windows, and the initial six Exodus
34 directions from one real 28:55 Luna/OpenRouter tour. The final eight records
are the D18 director refresh and two step-one calibrations described below.

| Cohort | N | Avg duration | Scenes | Visible beats | Beats/scene | Opening | Max entrance gap | Max internal blank | Closing | Active coverage | Variety |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Migrated v1 | 19 | 239.3s | 4.1 | 6.5 | 1.50 | 48.5s | 73.7s | 43.3s | 32.9s | 26.5% | 2.9 |
| Superseded D17 calibration | 1 | 84s | 3.0 | 7.0 | 2.33 | 1.0s | 29.0s | 18.0s | 15.0s | 59.5% | 1.0 |
| Current policy | 20 | 277.5s | 6.4 | 6.5 | 1.11 | 55.0s | 79.3s | 58.6s | 14.7s | 23.5% | 4.3 |
| Current long windows | 19 | 287.7s | 6.6 | 6.7 | 1.06 | 55.1s | 80.7s | 61.3s | 15.2s | 23.6% | 4.4 |
| All auditable | 40 | 254.5s | 5.2 | 6.5 | 1.32 | 50.6s | 75.4s | 50.3s | 23.4s | 25.8% | 3.5 |

The original Romans windows retained 39 of 44 target entrances. The initial
Exodus directions retained another 39 beats; the checked-in refreshed replay
retains 41. In every cohort, the precompiler/D17 fixed-dwell sparsity is
primarily a distribution and composition failure, not simply a low total
count.

### Per-run baseline

Kind legend: `G` group, `Fn` footnote, `T` term, `Al` allusion, `Co` compare, `Ch` chain, `Cv` caveat, `As` aside, `H` highlight. `O/E/I/C` is opening / maximum entrance gap / maximum internal blank / closing blank. Fill is accepted / transcript-qualified intervals.

`K/F` is the maximum consecutive same-kind / same-family run. The current reader deliberately refuses the policy-2 calibration, so that row is measured from its preserved raw result and explicitly labelled rather than silently upgraded.

| Run | Dur | Scenes/beats | Retained | Proposed / rejected | First→last | O/E/I/C | Active | K/F | Fill | Evidence |
|---|---:|---:|---|---|---|---|---:|---:|---:|---|
| 19-07-26-1d1d | 84 | 3/5 | G4 Al1 | — / — | G@1→G@69 | 1/22/9/6 | 58% | 3/3 | — | migrated v1 |
| 19-40-41-a4ea | 300 | 4/9 | G4 Al2 Co1 As1 H1 | — / — | G@54→Al@299 | 54/108/98/0 | 28% | 4/4 | — | migrated v1 |
| 19-40-41-e1ff | 295 | 3/4 | G2 As1 H1 | — / — | H@32→G@174 | 32/121/80/112 | 13% | 1/1 | — | migrated v1 |
| 19-40-50-4e12 | 125 | 3/4 | G3 H1 | — / — | G@42→G@113 | 42/42/23/3 | 30% | 2/2 | — | migrated v1 |
| 19-41-16-f3e2 | 265 | 4/10 | G7 Al1 As1 H1 | — / — | G@36→G@250 | 36/58/49/6 | 31% | 4/4 | — | migrated v1 |
| 19-41-21-93a1 | 300 | 4/7 | G6 H1 | — / — | G@119→G@248 | 119/119/43/43 | 22% | 4/4 | — | migrated v1 |
| 21-48-43-72ec | 244 | 5/9 | G2 Fn1 Cv1 As3 H2 | — / — | Cv@35→As@228 | 35/37/26/10 | 34% | 2/3 | — | migrated v1 |
| 21-48-43-ff80 | 236 | 5/9 | G3 T1 As3 H2 | — / — | As@15→T@218 | 15/44/33/9 | 36% | 2/2 | — | migrated v1 |
| 21-49-11-8def | 290 | 5/8 | G2 Al1 As1 H4 | — / — | H@24→Al@240 | 24/50/38/37 | 27% | 2/2 | — | migrated v1 |
| 21-49-36-c0c8 | 270 | 5/12 | G3 Fn2 Al2 Cv1 As2 H2 | — / — | G@8→As@238 | 8/40/29/22 | 40% | 2/2 | — | migrated v1 |
| 00-06-14-7c0b | 300 | 5/7 | As3 H4 | — / — | As@22→H@265 | 22/62/51/24 | 25% | 2/2 | — | migrated v1 |
| 00-06-14-eb8c | 261 | 5/6 | As4 H2 | — / — | As@41→H@256 | 41/55/46/0 | 20% | 3/3 | — | migrated v1 |
| 00-06-35-e654 | 203 | 4/5 | As3 H2 | — / — | As@59→As@198 | 59/67/57/0 | 19% | 2/2 | — | migrated v1 |
| 00-06-35-6d20 | 221 | 5/4 | As4 | — / — | As@46→As@195 | 46/52/42/16 | 18% | 4/4 | — | migrated v1 |
| 00-06-45-e03d | 265 | 0/0 | none | — / — | none | 265/265/0/265 | 0% | 0/0 | — | migrated v1 |
| 00-07-22-9d04 | 131 | 4/2 | H2 | — / — | H@34→H@92 | 34/58/47/28 | 17% | 2/2 | — | migrated v1 |
| 00-07-22-f06c | 300 | 5/7 | T1 As3 H3 | — / — | H@26→H@254 | 26/61/50/35 | 24% | 2/2 | — | migrated v1 |
| 00-07-39-fbe1 | 171 | 4/5 | T1 As1 H3 | — / — | T@6→As@151 | 6/82/71/10 | 30% | 3/3 | — | migrated v1 |
| 00-07-40-4701 | 285 | 5/11 | G7 Cv2 As1 H1 | — / — | G@57→H@280 | 57/57/30/0 | 31% | 3/3 | — | migrated v1 |
| 16-19-22-b595 | 84 | 3/7 | H7 | Co1 H10 / Co1 H3 | H@1→H@59 | 1/29/18/15 | 60% | 7/7 | 0/1 | raw policy 2; refused-current |
| 16-34-08-fb7f | 84 | 1/2 | T2 | T2 Co1 As1 / Co1 As1 | T@53→T@69 | 53/53/7/6 | 21% | 2/2 | 0/1 | current |
| 23-35-54-98de | 300 | 5/9 | Fn1 T4 Cv1 As3 | Fn1 T4 Co2 Cv1 As3 / Co2 | T@35→As@291 | 35/52/43/0 | 29% | 3/9 | 0/4 | current |
| 23-35-54-ae6b | 300 | 9/10 | G1 T3 Cv2 As3 H1 | G1 T4 Cv2 As3 H1 / T1 | As@40→As@293 | 40/51/41/0 | 31% | 2/4 | 2/3 | current |
| 23-36-19-314f | 300 | 7/7 | G1 Fn1 T1 Cv2 H2 | G3 Fn1 T1 Cv2 H2 / G2 | H@51→Fn@284 | 51/72/61/7 | 23% | 2/2 | 1/4 | current |
| 23-36-29-65e8 | 256 | 8/6 | Fn1 T1 Cv2 As1 H1 | G3 Fn1 T1 Cv2 As1 H1 / G3 | Cv@53→Cv@231 | 53/54/43/22 | 21% | 1/3 | 0/3 | current |
| 23-36-56-61d6 | 240 | 7/7 | T2 Cv2 As1 H2 | G2 T2 Cv2 As1 H2 / G2 | As@58→Cv@211 | 58/58/50/17 | 29% | 2/3 | 1/2 | current |
| 00-29-59-bdbd | 300 | 7/5 | G1 Co1 Cv1 As1 H1 | G4 Co1 Cv1 As2 H1 / G3 As1 | G@60→H@252 | 60/84/74/37 | 17% | 1/2 | 0/5 | current; Exodus live |
| 00-29-59-81e9 | 275 | 9/9 | Al1 Co1 Cv1 As4 H2 | Fn1 Al1 Co1 Cv1 As4 H2 / Fn1 | Cv@54→As@269 | 54/63/53/0 | 32% | 3/3 | 0/3 | current; Exodus live |
| 00-30-30-b2ef | 300 | 4/5 | Al3 Cv1 H1 | G2 Al3 Co1 Cv1 H1 / G2 | Al@89→Al@264 | 89/90/77/27 | 19% | 1/1 | 1/4 | current; Exodus live |
| 00-30-53-2e3f | 300 | 7/8 | Al1 Co3 Cv4 | Al1 Co3 Cv4 / none | Co@15→Cv@290 | 15/119/107/0 | 31% | 3/3 | 1/3 | current; Exodus live |
| 00-31-03-1925 | 260 | 8/6 | G1 T1 Al1 Co1 Cv1 As1 | G3 T1 Al1 Co1 Cv1 As1 / G2 | T@15→Cv@258 | 15/60/51/0 | 20% | 1/2 | 1/3 | current; Exodus live |
| 00-31-33-ce04 | 300 | 4/5 | Al2 Cv1 H2 | G1 T1 Al2 Co1 Cv1 As1 H2 / G1 T1 Co1 As1 | Cv@52→Al@271 | 52/104/94/16 | 19% | 2/2 | 0/4 | current; Exodus live |
| 01-21-43-bdbd | 300 | 6/6 | Co1 Cv1 As3 H1 | G4 Co2 Cv1 As3 H2 / G4 Co1 H1 | Co@122→H@252 | 122/122/33/37 | 20% | 3/4 | 0/4 | refresh 1; not checked in |
| 01-22-25-81e9 | 275 | 9/7 | Al1 Co1 Cv1 As3 H1 | G2 Fn1 Al1 Co1 Cv2 As3 H1 / G2 Fn1 Cv1 | Al@91→As@269 | 91/91/51/0 | 21% | 3/3 | 0/3 | refresh 2; checked in |
| 01-22-56-b2ef | 300 | 6/7 | T1 Al1 Co1 Cv1 As1 H2 | G1 T1 Al1 Co1 Cv1 As1 H3 / G1 H1 | H@10→Co@286 | 10/100/90/0 | 27% | 1/2 | 2/4 | refresh 3; checked in |
| 01-23-38-2e3f | 300 | 4/7 | Co2 Ch1 Cv2 As1 H1 | G1 Co2 Ch1 Cv2 As1 H1 / G1 | Cv@58→Co@294 | 58/86/74/0 | 28% | 1/2 | 1/4 | refresh 4; checked in |
| 01-24-12-1925 | 260 | 7/7 | Fn1 T1 Co1 As2 H2 | G1 Fn1 T1 Al1 Co1 As2 H2 / G1 | T@15→Fn@246 | 15/65/51/5 | 27% | 2/3 | 2/3 | refresh 5; checked in |
| 01-25-00-ce04 | 300 | 7/7 | T1 Al1 Cv2 As1 H2 | G1 T2 Al1 Co1 Cv2 As2 H2 / G1 T1 Co1 As1 | Cv@62→As@244 | 62/73/61/46 | 24% | 1/2 | 0/4 | refresh 6; checked in |
| 01-30-55-bdbd | 300 | 5/5 | As4 H1 | G4 As6 H1 / G4 As2 | As@107→H@252 | 107/107/38/37 | 15% | 4/4 | 0/3 | no-group calibration; not checked in |
| 01-33-13-bdbd | 300 | 7/5 | G1 Cv1 As2 H1 | G2 Co1 Cv1 As4 H1 / G1 Co1 As2 | G@60→H@252 | 60/82/73/37 | 15% | 2/3 | 0/4 | successful group calibration; checked in |

Across the original five Romans runs, 16 qualified gaps produced seven Luna
fill proposals and four accepted fills. Across all 20 current-policy records,
68 qualified gaps produced 12 accepted fills. The model-side plan therefore
still leaves long openings and gaps; the house compiler, not extra schema
quotas, is what supplies continuous editorial framing.

## Before and after the house compiler

The table above measures the precompiler/D17 fixed-dwell foreground. The comparison below passes the same saved directions through `magic-editorial.mjs` without another model call. Every per-direction comparison uses `stepIndex: 0` and `stepCount: 1`; the aggregate recompiles the five directions as ordered steps `0–4` of one five-step sequence.

| Run | Fixed foreground | Editorial shots | Semantic phases/beats | Semantic occupancy | Max explicit rest | Accidental gap | Family run | Focus | Scene coverage | Gates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 23-35-54-98de | 28.7% | 37 | 15/9 | 51.7% | 18s | 0s | 2 | 0% | 100% | 8/8 |
| 23-35-54-ae6b | 30.7% | 38 | 16/10 | 53.7% | 18s | 0s | 2 | 1.7% | 100% | 8/8 |
| 23-36-19-314f | 22.7% | 41 | 15/7 | 40.0% | 18s | 0s | 1 | 7.3% | 100% | 8/8 |
| 23-36-29-65e8 | 21.1% | 32 | 11/6 | 40.0% | 18s | 0s | 1 | 4.3% | 100% | 8/8 |
| 23-36-56-61d6 | 28.7% | 34 | 12/7 | 40.0% | 18s | 0s | 1 | 9.2% | 100% | 8/8 |

The five-step aggregate moves from **26.4% fixed-dwell foreground coverage to
45.4% compiled semantic occupancy**. Across 1,396 seconds it contains 182
editorial shots: 69 semantic phases traceable to all 39 retained beats, 634.4
semantic seconds, six bounded callbacks, and 492.6 seconds of explicit house
rests. Its maximum explicit rest is 18 seconds, maximum accidental gap is zero,
uncovered time is zero, maximum semantic-family run is two, focus share is 4.3%,
and scene coverage is 100%. All five directions reach the preferred 40–55%
band and the aggregate passes all eight continuity gates.

One deterministic trace example is:

```text
run: 23-35-54-98de
shot: shot:beat:beat:initial:0:0
time: 35–40s
component: AnchorFrame / lexicon / term
rule: semantic-term-term
source beat: beat:initial:0
source scene: scene:initial:0
```

The explicit rests are house-owned passage/listening framing, not invented
semantic claims. Zero uncovered time means the compiler always supplies a
current editorial shot; it does not mean every second contains semantic
novelty. These compiler and continuity results also do not establish browser
acceptance: mounting, layout, transitions, responsive behavior, and screenshot
quality remain a separate gate.

## Real Luna episode: historical first pass

One deliberate UI run asked Luna-medium through OpenRouter for a continuous
25–40 minute treatment of Exodus 34:6–7. The result was a 28:55 tour with six
clips, four publishers, 39 scenes, and 39 retained semantic beats. Its organic
mix was caveat 9, allusion 8, compare 7, aside 6, highlight 6, group 2, and term
1. It selected neither footnote nor chain. These initial six directions are
part of the first 32-record baseline and remain immutable historical evidence.

That historical sequence compiled to 207 shots and 663 semantic seconds
(38.2%). All six plans validated, covered 100% of source scenes, had no
uncovered interval, kept focus at 3.4%, and never exceeded an 18-second
explicit rest or a same-family run of two. Two movements reached the preferred
40% target; the other four were independently proven grounded-exhausted. The
original all-role generation cost `$0.0453416` across 22 Luna calls:
`$0.0258690` tour, `$0.0003131` whispers, `$0.0005336` form, and `$0.0186259`
for the six directors.

The historical compile also exposed adjacent triples from one renderer family.
The house compiler can now insert a grounded Scripture/listening resolve of up
to 3.5 seconds before a third same-family entrance while retaining each Luna
beat and its provenance. Callbacks remain capped at two per beat, so sparse
material cannot meet a percentage by replaying one card indefinitely.

## Eight-call director refresh

The same saved transcript windows were directed again after the complete-copy
and visual-variety instructions changed. This was eight director requests, not
a new search, tour, whisper, or form run:

| Refresh stage | Director requests | Luna calls | Cost | Result |
|---|---:|---:|---:|---|
| Six movement refresh | 6 | 12 | `$0.01990205` | Added chain and footnote; step one retained no group |
| No-group calibration | 1 | 2 | `$0.003196625` | Still retained no group; preserved as evidence only |
| Successful group calibration | 1 | 3 | `$0.0037899` | Retained one grounded group and became checked-in step one |
| **Director refresh total** | **8** | **17** | **`$0.026888575`** | Final replay uses the successful step one plus refreshed steps two–six |

Together with the original all-role run, D18 used `$0.072230175` across 39 Luna
calls. No Sol call was made. Re-running the evidence audit for this document
made no provider, model, or search call; it read only the saved append-only
records and checked-in replay.

## Current checked-in Exodus replay

The final organic mix is **group 1, footnote 1, term 3, allusion 4, compare 5,
chain 1, caveat 7, aside 10, and highlight 9**. All nine semantic visual kinds
therefore occur in a real Luna-directed full-episode replay; none was inserted
as an atlas-only quota.

| Step | Shots | Semantic phases/beats | Semantic occupancy | Callbacks | Family resolves | Max rest | Family run | Focus | Scenes | Target state | Valid |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 34 | 11/5 | 35.3% | 4 | 0 | 18s | 2 | 3.7% | 100% | grounded exhausted | yes |
| 2 | 35 | 11/7 | 33.5% | 2 | 0 | 18s | 2 | 4.0% | 100% | grounded exhausted | yes |
| 3 | 34 | 12/7 | 40.0% | 1 | 0 | 18s | 2 | 7.3% | 100% | preferred | yes |
| 4 | 33 | 11/7 | 41.7% | 0 | 0 | 18s | 1 | 3.7% | 100% | preferred | yes |
| 5 | 29 | 12/8 | 46.4% | 0 | 0 | 18s | 1 | 6.9% | 100% | preferred | yes |
| 6 | 33 | 12/7 | 40.0% | 1 | 0 | 18s | 1 | 5.7% | 100% | preferred | yes |

The final sequence compiles to **198 shots**, including 69 semantic phases
traceable to 41 retained beats and 683.5 semantic seconds (**39.4%**). It uses
eight bounded callbacks and needs no family resolve in this particular mix. It
has 785 seconds of explicit house rests, an 18-second maximum explicit rest,
zero uncovered time, zero accidental gap, maximum same-family run two, 5.2%
focus share, and 100% scene coverage. All six plans validate. Four movements
reach the preferred band and two stop below 40% only after the independent
validator finds zero legal callback opportunity. Consequently, the aggregate
passes seven of eight raw gates (only the literal 40% aggregate target misses)
and passes the operative `preferred target or grounded exhausted` gate for all
six movements.

## Original Romans component yield

The original five Romans-window proposal-to-retained yield was:

| Kind | Proposed | Retained | Yield |
|---|---:|---:|---:|
| Term | 12 | 11 | 92% |
| Caveat | 9 | 9 | 100% |
| Aside | 8 | 8 | 100% |
| Highlight | 6 | 6 | 100% |
| Footnote | 3 | 3 | 100% |
| Group | 9 | 2 | 22% |
| Compare | 2 | 0 | 0% |
| Allusion | 0 | 0 | — |
| Chain | 0 | 0 | — |

Thirty-four of those 39 retained components, 87%, were term, caveat, aside,
footnote, or highlight forms. The initial Exodus episode materially changed
that picture by organically retaining eight allusions and seven comparisons,
although it still selected no chain or footnote. The D18 refresh goes further:
the checked-in replay includes all nine semantic kinds, including one chain and
one footnote. This improves variety evidence without erasing the precompiler
distribution problem: long blank intervals still exist in the model-side
projection and are deliberately owned by the deterministic house compiler.

## Dominant failure modes

1. The planner has a quantity target but no opening, closing, per-band, occupancy, or maximum-rest contract. Near-target totals can still cluster badly.
2. Fill is a single optional pass. The model may omit a qualified interval, and a rejected proposal has no deterministic house fallback.
3. The most visually distinctive semantic types remain the most brittle. The
   Romans sample retained group 2/9 and compare 0/2. The final Exodus replay
   proves all nine kinds can survive organically, but group, chain, and footnote
   each occur only once and therefore still deserve yield monitoring.
4. Independent scenes and beats do not create an editorial sequence such as opener, development, relation, synthesis, and close.
5. Two of four accepted Romans fills were highlights. Focus must remain
   exceptional and cannot be the generic answer to sparse time.
6. All 41 beats in the checked-in replay project visibly. Its fixed-dwell
   sparsity is already present in the plan rather than being introduced by
   browser projection.

## Planner quality gates

For clips at least 90 seconds, use these as benchmark gates rather than model quotas:

- First component by 18 seconds.
- Closing inactive tail no longer than 15 seconds.
- No entrance gap longer than 30 seconds.
- No accidental component-free interval longer than 18 seconds. A longer rest must be explicitly labelled intentional.
- Preferred semantic occupancy between 40% and 55%; hard maximum 60%. Below
  40% is acceptable only when the validator independently proves that no
  grounded same-scene callback of at least three seconds remains.
- No beat may be used for more than two callbacks.
- No more than two consecutive components from one visual family, and no family above 40% of entrances.
- Focus at or below 12.5% of entrances, no more than one focus per 300 seconds, and no focus authored by fill.
- At least 85% of scenes carry a component or explicitly declare intentional quiet.
- At least 90% of qualified gaps receive a validated semantic component or deterministic house fallback.
- Broad repeatable components should maintain at least 90% validation yield.
- A five-minute composition should normally contain 12–14 distributed entrances, with at least two entrances in every 60-second band.

The implemented correction is a deterministic house pacing and composition
grid with broad, reusable components. Luna identifies grounded material; the
house owns continuity, bookends, exact rests, callback reuse, family
punctuation, and responsive layout.
