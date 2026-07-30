# Minimalist cleanup — what can be deleted so the app gets smaller and calmer

Lens: deletions and collapses only. Every claim below was verified against the frozen snapshot at
`/private/tmp/claude-501/-Users-jonnyroyal-dev-scripture-app/94f4876e-4122-4cc3-b070-0241f423837b/scratchpad/worktrees/ideation-snapshot`
(commit 9130779). Line numbers are snapshot line numbers; re-grep before cutting on a live branch. All paths below are snapshot-relative unless absolute.

Method note that matters: this codebase constructs class names dynamically (`theme-${theme}` app.tsx:1802, `hl-${color}` ScripturePage.tsx:3547, `kind-${e.kind}` LanguageWordsSection.tsx:773, `is-${...}`, `role-${...}`, `control-button--${variant}` Controls.tsx:37, `toast--${toast.tone}` Toast.tsx:140, `settings-job-status--${job.status}` SettingsPage.tsx:637, `theme-preview-${option.id}` ThemePicker.tsx:44, `marking-pigment-${color}` MarkingSurface.tsx:428, `marking-kind-${...}` MarkingSurface.tsx:487). A naive "class not found literally" sweep reports 235 dead classes; after checking every family for template construction, the honest dead set is the one below. Anyone doing this cleanup must run both greps — literal AND `prefix-\$` — per class before deleting.

---

## 1. The collapse/proxy remnant — the headline deletion (RANKED #1)

The strip stopped reading `collapsed` on 2026-07-30 ("THE REGISTER IS ONE STUDY AT A TIME", studyWorkspace.ts:1953-1966). What remains is a fully mapped corpse, kept on purpose at the time and now safe to bury. Exact inventory:

**Model (src/renderer/utils/studyWorkspace.ts)**
- `collapsed: boolean` field — line 84; initialized `false` at 444 and 481.
- `toggleStudyWorkspaceGroup` — lines 632-668 (a 21-line docstring plus function). **Zero production callers.** Only tests reference it (grep proof below). Its docstring still narrates the proxy tab in the present tense ("a collapsed study keeps a proxy tab in the strip carrying its own name", 642-643) — a comment that now lies.
- `visibleStudyWorkspaceTabIds` — lines 1912-1930 plus docstring. **Zero production callers**; `scripture-workspace-tabs-async-contract.test.ts:162` in fact *asserts it is not used* by the strip.
- `studyWorkspaceStripTabIds`'s docstring (1953-1966) says outright: "`collapsed` … is still in the model and still persisted, and nothing reads it any more."

**Persistence lockstep (src/electron/study-workspace-settings.ts)** — this is what a deleter must respect:
- `PersistedStudyWorkspaceGroup.collapsed` — line 95.
- `RawGroup.collapsed` — line 446.
- The validator **rejects the whole group** when `typeof source["collapsed"] !== "boolean"` — line 454. This is the lockstep: if the renderer stops writing the field before the main-process reader tolerates its absence, every saved workspace group is thrown away on next launch and the reader loses their open studies.
- Writers/copiers of the field: lines 523, 616, 954 (`collapsed: false` on legacy-origin group creation).

**Correct deletion order (can be one commit, but internally ordered):**
1. Make the reader tolerant: in `normalizeRawGroup` (line 448-468) drop the `collapsed` type check and stop copying it; old files on disk that carry `collapsed: true/false` still parse because unknown keys are already ignored by `asRecord`. No `WORKSPACE_VERSION` bump — version stays 2 (line 111); ignoring a field is backward- and forward-safe, unlike requiring one.
2. Drop the field from `PersistedStudyWorkspaceGroup`, `RawGroup`, and all three write sites.
3. Drop `collapsed` from `StudyWorkspaceStateV2` (studyWorkspace.ts:84, 444, 481) and delete `toggleStudyWorkspaceGroup` and `visibleStudyWorkspaceTabIds` whole.
4. Tests: delete the collapse/proxy suites in `tests/study-workspace.test.ts` (~lines 800-855 and 2860-2885, 24 grep hits); flip the keeper-assertions that currently pin the corpse in place — `tests/study-line-contract.test.ts:342` (`assert.match(model, /export function toggleStudyWorkspaceGroup\(/)` must become a `doesNotMatch` or be removed) and the "stays in the model, persisted and unread" commentary in `tests/scripture-workspace-tabs-async-contract.test.ts:40,155-162,224-234`.
5. Comments: remove the proxy eulogies. ScriptureWorkspaceTabs.tsx carries 25 grep hits of proxy/collapse narration (816-817, 832, 848-852, 927, 1002-1014, 1080-1082, 1206, 1358-1365, 1387, 1576-1581); app.tsx:1378-1386 carries the `toggleWorkspaceGroup` eulogy. Keep ONE short note at the model (where the field used to be) recording the 2026-07-30 ruling and that old files may still carry the key; delete the rest — six copies of the same obituary is not remembrance, it is noise.

**Diff size:** roughly −350 lines src, −120 lines tests, no new code beyond a 3-line comment.
**Risk:** low and enumerable. The single real hazard is step ordering (reader tolerance before writer silence); it ships in one commit so the hazard is only to reviewers reading the diff out of order. Old saved workspaces round-trip because the reader ignores rather than requires. Contract tests are the tripwire and get updated in the same commit.

---

## 2. Dead CSS families — ~900 verified-dead lines in styles.css (RANKED #2)

styles.css is 21,019 lines (25,549 across all renderer CSS). The following families have **zero literal references and zero template-construction sites** anywhere in `src/**/*.{ts,tsx,html}` (both greps run). Counts are lines occupied by their rule blocks:

| Family | Lines | Location | What it was |
|---|---|---|---|
| `lang-tree-*` (20 classes) | 171 | styles.css:12278 | old syntax-tree renderer; SyntaxArt.tsx now emits `lang-flow-*`/`lang-phrase-tree-*` instead (SyntaxArt.tsx:115,184) |
| `marking-dock-mode*`, `-modes` | 107 | styles.css:18098 | retired dock mode switcher; live dock uses `marking-dock-context/-resting` only (MarkingSurface.tsx:2337,2346) |
| `marking-dock-actions/-intent(s)/-thumb/-quote/-retry/-selection/-tool-*/-put-down/-feedback/-hit/-spinner` | ~166 | styles.css:18346-18534 | the previous dock's action/feedback stage, incl. a spinner the current design law forbids |
| `marking-armed-*`, `marking-back`, `marking-keep` | 52 | styles.css:17946-17998 | pre-dock "armed" state UI |
| `margin-hl-palette/-pill/-swatch` | 61 | styles.css:10684 | old margin highlight palette |
| `btn-secondary` | 46 | styles.css:7505 | pre-`control-button` button family |
| `note-workspace-search*`, `note-search-clear`, `note-workspace-empty-icon`, `note-list-loading` | 60 | styles.css:6349,6819 | removed note-workspace search |
| `margin-stat(s)/-label/-num` | 30 | styles.css:10611 | margin stats block ("dashboard chrome" — correctly removed from JSX, CSS left behind) |
| `trusted-resource-scrub*` | 30 | styles.css:20478 | pre-player audio scrubber on resource cards; superseded by the podcast player |
| `passage-popback` | 27 | styles.css:3435 | removed pop-back control |
| `focus-exit-chip` | 22 | styles.css:15647 | removed focus-mode exit chip |
| `highlight-margin-item/-swatch/-delete-btn` | 33 | styles.css:10496-10509, 6046 | old margin highlight list |
| `ai-insight-loading/-none/-label` | 28 | styles.css:14269-15978 | old AI-insight placeholders (`ai-insight-spinner` at 14278 IS still used — LivingMargin.tsx:4389) |
| `hl-blob`, `hl-sweep` | 13 | styles.css:5610 | old highlight paint (note `hl-yellow` etc. are ALIVE via `hl-${color}`) |
| `margin-empty/-hint`, `margin-invite`, `mixed-context`, `semantic-loading`, `margin-view-heading` | 36 | styles.css:10539,15901,15960,10530,8681 | removed empty/loading margin states |
| `margin-section-toggle/-caret/-count` | ~20 | styles.css:5804 | old collapsible margin sections (`margin-section-header` alive, LanguageWordsSection.tsx:1189) |
| `xref-more-btn`, `nav-divider`, `preview-dock`, `preview-palette`, `floating-material-host`, `rc-segmented`, `loading-text-inline`, `margin-overview-loading`, `command-palette-trigger-label`, `scripture-workspace-caret`, `verse-nums-faint/hover`, `intent-entity-caret` | ~45 | scattered | one-off leftovers; verify `verse-nums-` against constructions before cutting |
| `.theme-paper, .theme-slate` selector aliases | 2 selector lines | styles/marking-actions.css:20-21 | theme ids that never existed — `AppTheme` is `light\|dark\|porcelain\|onyx` (theme.ts:13). The block is alive via `:root`; only the two selectors are vestigial. Worth a second look that no rule elsewhere *intended* `.theme-light` and wrote `.theme-paper` — that would be a silent bug, not just cruft |

**Diff size:** ~900-950 deleted lines, zero added.
**Risk:** low, mechanical, but only with the two-grep protocol per class (literal + `\`prefix-\$`). The false-positive list from the naive sweep (`theme-preview-*`, `theme-swatch-*`, `kind-*`, `role-*`, `is-*`, `tone-*` via `is-${action.tone}`, `hl-<color>`, `control-button--*`, `toast--*`, `settings-job-status--*`, `settings-ai-dot--*`, `reading-size-*`, `marking-pigment-*`, `marking-kind-*`, `entity-relationship-*`, `entity-location-*`, `entity-research-*`, `taught-here-*`, `resource-source-*`) must NOT be touched. Visual QA tour scripts (`scripts/qa-*.mjs`) reference none of the dead classes (grep verified), so the QA suite passes unchanged.

---

## 3. Orphaned binary assets — 3.4 MB for a theme that no longer exists (RANKED #3)

- `src/renderer/assets/glass-dark.png` (1.8 MB) and `glass-light.png` (1.7 MB): **zero references** anywhere in src, vite.config.ts, or any CSS `url()` (grep for the filenames returns nothing). They were the background textures for the retired "glass"/"dark-glass" themes, which theme.ts:15-16,71-78 now migrates to `material: "translucent"`. The migration code (`migrateLegacyTheme`) must stay; the PNGs must go.
- `src/renderer/assets/brand/pending/` (256 KB, incl. `reconstructed/ask-nt-wright-horizontal-white.png` and `reversed/*`): **do not delete** — this is plausibly the staging queue for player Build 2's brand marks (in flight). Flag for the player-surface owner to either promote or remove when Build 2 lands.
- All six non-pending brand files are referenced (1 hit each) — keep.

**Diff size:** −3.4 MB repo weight, 0 lines. **Risk:** none measurable; the app cannot load a file nothing names.

---

## 4. Dead CSS custom properties and phantom consumers (RANKED #4)

41 custom properties are **defined and never consumed** by any `var()` in CSS or TSX (setProperty included in the scan). Notable, with definition sites in styles.css:

- `--viz-1` … `--viz-9` (styles.css:453ff) — a nine-color dataviz palette with no chart consuming it. Nine settings nobody set.
- `--hl-blue/-green/-pink/-purple/-yellow` base washes (styles.css:51-55) — superseded by the `--quire-hl-*` oklch system in styles/marking-actions.css:19-35. (The `-a/-mid/-b/-edge/-mark` variants ARE consumed; only the five bases are dead.)
- `--map-grid`, `--map-land`, `--map-land-line` (styles.css:214-216) — no map surface exists.
- `--page-max-width` (styles.css:332), `--radius-modal`, `--shadow-topbar`, `--accent-warm(-light)`, `--accent-xref`, `--accent-seal-strong`, `--canon-block`, `--fs-xl`, `--lh-tight`, `--lh-relaxed`, `--sp-2xl`, `--transition-instant`, `--text-link(-hover)`, `--primary`, `--secondary`, `--ghost`, `--study-hover-line`, `--toast-fg-subtle`, `--toast-overlay-bg(-hover)`.

The mirror list — `var()` consumers with **no definition** — is mostly JS-set at runtime (`--mark-*`, `--podcast-played` set inline at PodcastPlayer.tsx:1199) and safe, but four look like genuine phantoms silently falling back to `initial`/inherited values: `--surface-page`, `--focus-ring`, `--color-error`, `--accent`, `--bg-input`, `--surface-hover`, `--fw-bold`, `--toast-duration`. Each is a styling decision that is quietly not happening. Fixing these is not deletion, so: delete the 41 dead definitions in this pass, file the phantom consumers as a one-line follow-up for whoever owns the affected rules.

**Diff size:** ~45 lines. **Risk:** near-zero for the dead definitions; each is a single-line cut with a grep proving no consumer. The `--viz-*` block only if no chart work is queued — check with main before cutting that one family.

---

## 5. Comments that lie about the code (RANKED #5 — small diff, high honesty value)

This codebase's comments are its institutional memory, so a lying comment is worse here than elsewhere:

- styles.css:14331-14333 — "The one loading device in the app: a 1px seal segment travelling a hairline… **No spinners, no skeletons — anywhere.**" Fifty-three lines above it sits `.ai-insight-spinner` (14278, live — LivingMargin.tsx:4389), and the file also carries `.loading-spinner` (7143, live — app.tsx:1837), `.loading-spinner-sm` (7153, live — SettingsPage.tsx:543), `.control-button-spinner` (7622, live — Controls.tsx:46), and the dead `.marking-dock-spinner` (18429). The claim is false five times over. Either the comment is the law (see item 6) or it must be rewritten to name its actual scope (the sidebar footer).
- MarkingSurface.tsx:306 — "No spinners, no skeletons, anywhere" — same false claim, second location.
- studyWorkspace.ts:641-648 — `toggleStudyWorkspaceGroup` docstring describes the proxy tab in the strip in present tense; the proxy was removed 2026-07-30. Dies with item 1.
- styles/mobile.css:4 and styles/marking-actions.css:5 both say rules live in partials "rather than in styles.css, so this work can proceed without serialising on an **17k-line file**" — it is 21k now; the number will always lie. Drop the number.

**Diff size:** ~15 lines. **Risk:** none.

---

## 6. Two-mechanisms-where-one-would-do: the spinner family (RANKED #6)

Four live ring-spinner classes with three separate `@keyframes` doing the identical 360° rotation: `spin` (styles.css:7163), `control-spin` (7632), and the dead `marking-dock-spin` (18534); `.ai-insight-spinner` (14278) rides one of them. The design language already names its preferred loading device (the travelling hairline segment, styles.css:14331; LivingMargin.tsx:3334 "the thing named, never a spinner"). Minimal collapse without a design debate: one `@keyframes spin`, one `.spinner` base class with size modifiers, four call sites updated (app.tsx:1837, SettingsPage.tsx:543, Controls.tsx:46, LivingMargin.tsx:4389). The fuller move — replacing the four spinners with the named-thing/hairline device — is a design task, not a cleanup, and should be left to the reader's taste.

**Diff size:** ~40 lines net negative. **Risk:** low; visual QA tours (`qa:controls`, `qa:margin`, `qa:setup`) cover three of the four sites.

---

## 7. Stale root docs (RANKED #7)

- `CURRENT_STATE.md` (40 lines, repo root) — describes the pre-rebuild prototype: "Snapshot target branch: `codex/prototype-snapshot`", "`npm test`: 3 tests passed" (the suite is now dozens of files), M2-M7 milestones nobody references. STATUS.md is the live status document. Delete, or move under docs/ as history. Grep proof of orphanhood: nothing in src/, scripts/, tasks/, or docs/ links to it.
- `HANDOFF-smart-shapes.md` (330 lines, repo root) — explicitly a pause handoff dated 2026-07-19 for the Loom geometry port. The connections revival is in flight NOW (per session state), so this is either the active brief (keep until the revival lands, then delete) or already superseded by the in-flight work's own notes. Ask the connections owner; do not delete unilaterally.
- `docs/quire-redesign-status.md`, `docs/language-margin-history.md`, `docs/step-word-card-parity.md`, `docs/living-margin-*-mockup.{html,png}` — status/mockup documents for surfaces that have since shipped or moved on. Cheap to keep, but the mockup HTML/PNGs describe a Living Margin that no longer looks like that; a `docs/history/` move keeps the root honest without destroying provenance.
- `docs/ui-audit/` is **97 MB** of screenshots, actively regenerated by the qa tours (git status shows them churning every run). Not a deletion candidate — the tours need baselines — but every re-run permanently grows git history by tens of MB. Worth one decision: either stop committing regenerated screenshots (gitignore + keep golden copies only) or accept the growth knowingly. This is the single largest repo-size lever found.

**Diff size:** −40 to −400 lines of markdown plus optional 97 MB policy decision. **Risk:** none for CURRENT_STATE.md; coordination needed for the handoff and ui-audit policy.

---

## Not proposed, and why

- `lab/` (4 MB) — protected by standing decision (English-alignment-lab-first; lab must stay healthy). Untouched.
- `site/` (8.4 MB) — the marketing/brand site; unreferenced by the app but presumably wanted. Flag only.
- `theme.ts` legacy migration (`LegacyAppTheme`, `migrateLegacyTheme`) — still needed for any settings file written before the theme split. Keep.
- `mobile.css` coarse-pointer gestures in a desktop Electron app — plausibly intentional (touchscreen laptops); H·2 comment says it is owned work. Keep.
- QA scripts — all 31 `scripts/qa-*.mjs` reference only live selectors (grep across dead-class list returned zero hits). Nothing retired found.

---

## The one-day cleanup commit I would defend to the reader's face

**"Bury the collapse field, and sweep the dead marking/lang-tree CSS behind it."** One commit, one reviewer, one afternoon:

1. **Persistence first** (src/electron/study-workspace-settings.ts): in `normalizeRawGroup` remove the `typeof source["collapsed"] !== "boolean"` clause (line 454) and the `collapsed` copy at 468; drop the field from `PersistedStudyWorkspaceGroup` (95) and `RawGroup` (446); remove writers at 523, 616, 954. No version bump — readers now ignore the key old files still carry.
2. **Model** (src/renderer/utils/studyWorkspace.ts): delete `collapsed` from `StudyWorkspaceStateV2` (84) and its initializers (444, 481); delete `toggleStudyWorkspaceGroup` (632-668) and `visibleStudyWorkspaceTabIds` (1912-1930) entire, docstrings included. Add one 3-line comment at the type recording the 2026-07-30 one-study-register ruling and that persisted files may still carry `collapsed`, ignored.
3. **Tests**: in `tests/study-workspace.test.ts` delete the collapse/proxy cases (~800-855, ~2860-2885). In `tests/study-line-contract.test.ts` replace line 342's keep-assertion with `assert.doesNotMatch(model, /toggleStudyWorkspaceGroup/)`. In `tests/scripture-workspace-tabs-async-contract.test.ts` update the narration at 40, 155-162, 224-234 so the contract now asserts the functions are gone rather than "persisted and unread". `tests/study-workspace-shortcuts-contract.test.ts:13` narration likewise.
4. **Comments**: strip the 25 proxy eulogies from ScriptureWorkspaceTabs.tsx and the one at app.tsx:1378-1386; fix the lying docstring context left in studyWorkspace.ts.
5. **CSS sweep riding along** (same commit because the dock corpse and the proxy corpse are the same era): delete the `marking-dock-mode/actions/intent/thumb/quote/retry/selection/tool/put-down/feedback/hit/spinner`, `marking-armed-*`, `marking-back`, `marking-keep` blocks (styles.css 17946-18534 region, ~330 lines), the `lang-tree-*` family (12278, 171 lines), and `@keyframes marking-dock-spin` (18534). Run each deletion through the two-grep protocol (literal + `\`name-\$` construction) as the gate.
6. **Verify**: `npm run typecheck && npm test`, then `qa:study-workspace-bar`, `qa:marking-dock`, `qa:marking-palette` tours against the built app; confirm a workspace settings file saved from the previous build (with `collapsed: true` in a group) loads with all studies intact.

Net: roughly **−1,000 lines and one field of phantom state**, the persistence contract simplified to what the app actually does, and the tab strip's source finally reading like the thing it became on 2026-07-30 — with zero visible change for the reader, which is the point.
