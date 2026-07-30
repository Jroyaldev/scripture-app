# Unfinished features — the honest inventory

Lens: built-but-not-finished. Everything below was verified against the frozen snapshot at
`scratchpad/worktrees/ideation-snapshot` (commit 9130779). Paths are snapshot-relative unless
absolute. Items the in-flight builds already own are listed only in §"Verified, but owned"
so nobody re-litigates them.

Method: per-symbol reachability scan of every `export function/const/class` in `src/` against
all of `src/`, `tests/`, `scripts/`; importer graph of all 33 renderer components; IPC-channel
diff (`ipcMain.handle` in main.ts vs `ipcRenderer.invoke` in preload.ts vs `window.api.*` calls
in the renderer); CSS class-selector orphan scan (with dynamic-template false positives checked
by hand); data-artifact-to-runtime-loader tracing for every import script in `package.json`.

---

## 1. The UBS flora/fauna/realia and routes/parallels corpora: imported, parsed, tested — and no code path ever loads them

**The strongest finding in the sweep.** Two complete licensed datasets sit in the repo with
their full import + parse + test stack built, and not one byte reaches a reader.

What exists:
- Data: `data/scripture/ubs/flora-fauna/` (16 MB — `FLORA_1.1_en.xml`, `FAUNA_1.1_en.xml`,
  `REALIA_1.1_en.xml`, `ubs-flora-fauna-anchors.json`, `ubs-flora-fauna-index.json`,
  per-image copyright JSON, CC-BY-SA license) and `data/scripture/ubs/routes-parallels/`
  (2.8 MB — `routes.json`, `parallel-passages.json`, doctor reports, license).
- Parsers: `src/core/entities/ubs-flora-fauna.ts` (580 lines) and
  `src/core/entities/ubs-routes-parallels.ts` (961 lines) — including verbatim curated
  attribution strings (`UBS_FFR_ATTRIBUTIONS`, ~line 54) and a documented broken-image-path
  quirk (`UBS_FFR_PATH_IS_UNUSABLE`, `:108`).
- Importers: `scripts/import-ubs-flora-fauna.ts`, `scripts/import-ubs-routes-parallels.ts`
  (npm scripts `import:ubs-flora-fauna`, `import:ubs-routes-parallels`).
- Tests: `tests/ubs-flora-fauna.test.ts`, `tests/ubs-routes-parallels.test.ts`.

What does NOT exist: any importer of either core module outside its own import script and its
own test. Grep across all of `src/` finds zero references from `src/host/`, `src/electron/`, or
`src/renderer/`. There is no host loader (contrast `src/host/place-research-loader.ts`, which is
the exact template), no IPC channel, no margin section.

Finishing it: a host loader modeled on `place-research-loader.ts`, one read-only IPC channel,
and a section in the entity research pane (`LivingMargin.tsx` entity view) for flora/fauna/realia
plates on matching entities, plus a "parallel passages" drawer keyed off the current pericope for
`parallel-passages.json`. The anchors file already exists (`ubs-flora-fauna-anchors.json`), so
the reference plumbing is a lookup, not a research project. Attribution strings are already
curated — provenance honesty is pre-solved.

Deleting it: frees 19 MB of repo data, ~1,540 lines of core code, two scripts, two tests.

**Verdict: FINISH — flora/fauna/realia into entity research first; parallel-passages second;
routes.json can wait.** This is precisely the app's taste: licensed, attributed, evidence-grade
material for entities the margin already researches. It is the largest body of fully-paid-for
work in the repo with zero user-visible return.

---

## 2. "Ask Intelligence" is a doorway painted on a wall — and its back half is a dead IPC trio

Two halves of one unbuilt feature, discovered separately:

- **Front half:** the command palette routes questions to an "Ask Intelligence about "…"" row
  (`src/renderer/components/CommandPalette.tsx:1063-1071`), with careful design prose about how
  Intelligence "is the only scope that leaves this device" (`:1080-1084`). Its `activate:` is
  `onRunAction("open-settings")` — asking a question opens the Settings page. There is no ask
  surface, no answer surface.
- **Back half:** `ipcMain.handle("ai-invoke", …)` (`src/electron/main.ts:3914`) — a complete
  prompt→provider→budget-ledger loop — plus `get-ai-status` (`:3931`) and `enqueue-ai-job`
  (`:3944`) are **never exposed in preload.ts** (verified by channel diff). No renderer code can
  reach them. `get-ai-status` still reports `provider: "deepseek"`, dating it. `enqueue-ai-job`
  invokes the provider with the literal prompt `` `Job: ${opts.kind}` `` — placeholder code.

Finishing it: decide what a question deserves (probably a margin-grade answer card with the
retrieval evidence `runSemanticMargin` already assembles), expose one channel, wire the palette
row. Real design work — the answer surface is the hard part, not the plumbing.

Deleting it: removes three handlers (~80 lines in main.ts) and makes the palette row honest
("Intelligence settings" or removal). Frees the misleading affordance, which is the real cost:
the palette currently advertises a capability the app does not have.

**Verdict: DELETE the three dead handlers now; keep the palette's routing grammar; build the
answer surface only when it can be done at margin quality.** The reader values evidence over
speculation — a Q&A box that opens Settings is the opposite of quiet premium.

---

## 3. The plugin system: 510 lines, validated manifests, capability broker, zero plugins, zero imports

What exists: `src/core/plugins/` (`index.ts` 14, `manifest.ts` 195, `types.ts` 73 lines —
manifest validation with capabilities), `src/host/plugin-runtime.ts` (61 lines),
`src/host/plugin-broker.ts` (167 lines). The live library even has an empty
`~/ScriptureLibrary/.artifacts/plugins/` directory.

What does not: nothing in `src/electron/main.ts` (or anywhere else) imports `plugin-runtime` or
`plugin-broker`; no `plugin.json` exists anywhere in the repo. The subsystem is unreachable from
a running app.

Finishing it: an entire extension-model design — loader lifecycle, sandboxing, a real first
plugin. Nothing on the roadmap asks for it; trusted resources already solved third-party
content the app's own way (manifest grants, provenance footings).

Deleting it: frees ~510 lines plus the mental tax of a second, competing extension story
alongside `docs/trusted-resource-permissions.md`.

**Verdict: DELETE.** The trusted-resource system is the app's actual answer to "outside
material"; the plugin scaffold is a road not taken.

---

## 4. Dead renderer bridge surface: six preload methods and three IPC handlers nobody calls

Verified caller-by-caller:

| Item | Where | Status |
|---|---|---|
| `get-margin` handler | `main.ts:2424` (calls `assembleMargin`) | not in preload; superseded by per-part IPC + `runSemanticMargin` (which still uses `assembleMargin` — the core fn is alive, the handler is dead) |
| `get-all-notes` / `get-note` handlers | `main.ts:2660` / `:2672` | not in preload; `read-all-notes` is the live path |
| `insertClaim` / `insertOverlay` / `promoteOverlay` | `preload.ts:207/216/200-206`, typed in `api.ts:188-213` | exposed, never called by any component — claims/overlays are written host-side by the semantic margin |
| `getFacts` | `preload.ts:233`, `api.ts:222` | exposed, never called (`getJobs` next to it IS used, `SettingsPage.tsx:221`) |
| `getEnrichment` | `preload.ts:184`, `api.ts:171` | exposed, never called — `WritingSheet.tsx:99` consumes `enrichNote`'s direct echo; NoteCapture fires-and-forgets (`NoteCapture.tsx:281`, deliberate per B3.6 resurfacing) |
| `embedNotes` | `preload.ts:182`, `api.ts:169` | exposed, never called from the renderer (smoke scripts drive embedding) |

Finishing: nothing here wants finishing.
Deleting: ~150 lines across main.ts/preload.ts/api.ts, and — more valuably — a truthful bridge:
every method in `window.api` would again mean "the app does this."

**Verdict: DELETE all of it in one pass.** Zero risk; every live consumer verified.

---

## 5. Study-workspace zombies: a persisted field whose only gesture was retired

Verified against the snapshot:
- `toggleStudyWorkspaceGroup` (`src/renderer/utils/studyWorkspace.ts:653`) and
  `visibleStudyWorkspaceTabIds` (`:1918`) are production-dead; the retirement is *documented in
  place* — app.tsx:1378-1387: "toggleWorkspaceGroup stood here and is retired 2026-07-30 with
  the collapse gesture itself … `toggleStudyWorkspaceGroup` stays in the model with the
  exclusivity ruling it carries, unread."
- `collapsed` stays in `StudyWorkspaceStateV2` and stays persisted; `studyWorkspaceRegisterTabIds`
  (`:1943`) is "deliberately blind to `collapsed`."
- `orderedStudyWorkspaceGroups` (`:1895`) is called only from `tests/study-workspace.test.ts:142`.

Finishing: n/a — the strip holds one study by construction now; there is nothing for a collapse
to change on screen.
Deleting: `toggleStudyWorkspaceGroup` + `visibleStudyWorkspaceTabIds` + their tests (~120 lines),
then a v2→v3 field migration to drop `collapsed`. The migration is the only real cost.

**Verdict: LEAVE for now, exactly as the in-code comment argues — but put "amputate `collapsed`
in the next workspace format bump" on the ledger so the zombie field doesn't outlive everyone's
memory of why it exists.** The old saved-workspace round-trip guarantee is worth keeping until a
format bump happens for other reasons; carrying it forever is not.

---

## 6. Smart Shapes / Loom: a paused lab whose missing prerequisite has since been built

What exists: the whole `lab/` directory (route-engine.js, trace-geometry.js, patterns.js, four
HTML harnesses) and a first-class pause document, `HANDOFF-smart-shapes.md` — "the routing and
disclosure system is a strong, committed lab proof … The strict TypeScript/app port has not
begun." `lab/TODO.md` §1 names the blocking engineering problem in caps: **translation fragility
of user marks** — marks anchored `{ref, phrase, occ}` in WEB silently fail to resolve in KJV.

What changed since the pause: the occurrence-alignment substrate is now real —
`src/core/annotations/occurrence-alignment.ts`, `backbone-token-anchor.ts`, and shipped
`occurrence-alignments-v1` packages for WEB/KJV/YLT (commit d3712ab, with freshness and
conformance gates). That is, verbatim, the "reuse the canonical/word-level anchoring machinery;
resolve to other translations via the existing alignment path" plan `lab/TODO.md` §1 asked for.
The prerequisite the handoff was waiting on has been built for a different consumer.

Caveat on ownership: the connections-aesthetics revival in flight owns the *visual grammar*
(colinear underline runs + verticals + one soft corner). What nobody currently owns is the
`lab/TODO.md` §1 *anchoring* work — translation-durable user marks with honest degradation
("not found in KJV" as visible absence, one-click remap).

**Verdict: FINISH the anchoring half (TODO §1) as its own task, on top of the landed alignment
packages; leave the geometry port to the in-flight revival.** Also on the same TODO, already
decided elsewhere: marks library deferred (§2), rest-state collision shipped-first-pass (§3) —
no action.

---

## 7. The retired `lang-tree` rendering: ~90 lines of styled states no component reaches

`styles.css:12278` onward defines a complete `lang-tree` / `lang-tree-branch` /
`lang-tree-leaf-*` / `lang-tree-svg` family (13 orphan selectors verified — no TSX emits any of
them, and unlike `lang-flow-*`/`role-*`/`tone-*` there is no dynamic template that could).
`SyntaxArt.tsx` (`lang-flow-group`, `SyntaxArtView`) is its living successor, reached via
`LanguageWordsSection.tsx:1424` → `StructureModal`.

The broader orphan scan found 254 class selectors with no literal match in the renderer; most
are legitimate dynamic classes (`hl-${color}` `ScripturePage.tsx:3547`, `kind-${e.kind}`
`LanguageWordsSection.tsx:773`, `theme-*`, `settings-job-status--*`, `toast--*`,
`reading-size-*`). After discarding those, the confidently dead clusters are: `lang-tree-*`,
`ai-insight-*` (`ai-insight-label/loading/none` — no "ai-insight" string anywhere in TSX),
`margin-stat/-stats/-stat-num/-stat-label`, and `crossref-context/-kinds/-support/-total`.
(`taught-here-*` is also dead but Build 3's merged margin surface owns that ground.)

**Verdict: DELETE the four clusters (~150 lines of CSS); leave the rest of the orphan list to a
dedicated cleanup pass with the dynamic-template caveat attached.**

---

## 8. The fresh-init landmine: the default library path still points into iCloud

`src/electron/main.ts:1704` — `resolve(app.getPath("documents"), "ScriptureLibrary")` — and
`src/cli/index.ts:39` — `resolve(homedir(), "Documents", "ScriptureLibrary")` — are the final
fallbacks when no stored path or `LIBRARY_PATH` exists. The library was deliberately moved to
`~/ScriptureLibrary` because SQLite on iCloud-synced Documents caused the EINTR / disk-I/O
freezes. The decision was made; the defaults were never updated. Today the stored `libraryPath`
masks it, but any fresh init (new machine, cleared store, CLI `library init`) re-creates the
exact failure mode that was diagnosed and escaped.

**Verdict: FINISH (one-line fix ×2): default to `resolve(homedir(), "ScriptureLibrary")`.**
Smallest item on this list; highest regret-per-line if left.

---

## 9. Minor dead exports (delete casually, none block anything)

- `OpenAIEmbeddingProvider` — `src/host/ai-provider.ts:145`; local provider won.
- `getSharedReverseIndexLoader` — `src/host/reverse-index-loader.ts:107`; main.ts constructs
  `ReverseIndexLoader` directly (`main.ts:2083`).
- `resetPassageIndex`, `passageIndexPath` — `src/host/passage-index-loader.ts:21,26`; no callers
  anywhere including tests.
- `buildPlaceMiniMap` / `minimap()` — `src/core/entities/place-research.ts:213,179`; the C·2
  redesign deliberately removed the decorative minimap from the margin, and
  `tests/place-research.test.ts:148-152` *asserts* `research()` must not compute it — yet the
  builder and its geometry tests remain. Delete the builder + its test, keep the assertion.
- `buildReverseOrbit` — `src/core/language/reverse-index.ts:228`; orbit assembly moved to
  `token-package-loader`.
- `isCodexAvailable` — `src/host/codex-provider.ts:108` (the provider itself is live in the
  enrichment tier chain, `main.ts:3599`; only this probe is dead).
- `stripUsfmInlineMarkup` (`core/importer/usfm-text.ts:59`), `decodeRtfHexByte`
  (`core/importer/rtf.ts:39`), `lexicalWordsForRoundTrip` (`core/annotations/occurrence-alignment.ts:473`),
  `studyWorkspaceCloseActionCopy` (`ScriptureWorkspaceTabs.tsx:128`), `countMutedRules`
  (`ResourceLibraryMatrix.tsx:63`), `formatEntityResearchOrigin` + `OpenInTabIcon`
  (`LivingMargin.tsx:1665,909`).

**Verdict: DELETE in one hygiene commit** (~300 lines total). Constants that are documentation
(`MOUNCE_LICENSE_TEXT`, `UBS_INDEX_README`, `TRUSTED_RESOURCE_MANIFEST_SCHEMA`, the deprecated
`hiddenResourceSources`/`hiddenResourceKinds` store keys at `main.ts:248-250` which the launch
migration still reads) should stay.

---

## Verified, but owned by in-flight builds — reported here only as confirmation

- **Dock chapter subsystem + rail ticks:** confirmed exactly as the discovery report states —
  `PodcastEpisode.chapters` documented "currently never supplied" and supplied by no
  `playPodcastEpisode` call site, so the chapter list (`PodcastPlayer.tsx:896-918`), the
  `podcast-dock-now` line (`:1027-1036`), and the rail ticks (`:1073-1080`) never render, while
  the timestamped `refs` that could fill the rail sit in scope unused. Owned by Builds 2/3
  (rail ticks from references is explicitly queued).
- **`idle` player status:** in the vocabulary (`PodcastPlayer.tsx:110`) and unreachable while
  the dock is drawn. Build 2 owns the state vocabulary.
- **Word timings:** NOT unused in the strong sense — `readingLines(transcript.words)`
  (`PodcastPlayer.tsx:891`, `core/transcripts.ts:142`) builds every displayed line from them,
  and per-word granularity beyond that is refused by decision (no karaoke). Verdict: leave,
  permanently.
- **Transcript loader's dropped free-text:** `readTranscript` (`core/transcripts.ts:213-231`)
  keeps only `words` + `segments`; whether a flat text field should feed library-wide transcript
  search is the already-open product question — not re-proposed here.
- **`taught-here-*` dead CSS** and the moment→player→margin loop gaps: Build 3's merged margin
  surface.
- **Stale QA selectors** (`qa-study-workspace-bar.mjs:371`, `qa-desktop-reading-control.mjs:575`
  querying the no-longer-emitted `[data-study-group-tab]`; `ScriptureWorkspaceTabs.tsx:859`
  guarding on it): already on model-map's list; belongs to whichever cleanup pass lands first.

---

## Ranked summary

| # | Item | Verdict | Size of truth |
|---|---|---|---|
| 1 | UBS flora/fauna/realia + parallels: 19 MB + 1,540 lines, zero readers | **Finish** | data+code+tests all exist; only the loader/UI missing |
| 2 | "Ask Intelligence" → opens Settings; `ai-invoke`/`get-ai-status`/`enqueue-ai-job` unexposed | **Delete handlers, keep routing honest** | main.ts:3914-3970, CommandPalette.tsx:1063-1071 |
| 3 | Plugin system, 510 lines, no imports, no plugins | **Delete** | core/plugins + host/plugin-{runtime,broker} |
| 4 | Dead bridge: get-margin/get-all-notes/get-note + 6 uncalled preload methods | **Delete** | verified caller-by-caller |
| 5 | `collapsed` + toggle/visible selectors, gesture retired 2026-07-30 | **Leave; amputate at next format bump** | studyWorkspace.ts:653,1918; app.tsx:1378 |
| 6 | Loom anchoring (lab/TODO §1) — prerequisite (occurrence alignments) has since shipped | **Finish the anchoring; geometry stays with the revival** | HANDOFF-smart-shapes.md; occurrence-alignment.ts |
| 7 | `lang-tree-*`, `ai-insight-*`, `margin-stat*`, `crossref-*` orphan CSS | **Delete** | styles.css:12278+ et al. |
| 8 | Default library path falls back into iCloud Documents | **Finish (2 lines)** | main.ts:1704, cli/index.ts:39 |
| 9 | ~20 misc dead exports incl. the anti-tested minimap builder | **Delete** | one hygiene commit |

The one I would defend to the reader's face is #1: he already paid — in licensing diligence,
import engineering, attribution curation, and 19 MB of repo weight — for a museum of biblical
plants, animals, artifacts, and parallel passages, and the app has never once shown him any of it.
