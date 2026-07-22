# UX/UI Gap Audit — Post-D8 Study Workspaces (2026-07-22)

Scope: the 22 commits `f1d51cb..65ed79a` (grouped research tabs → pastoral study workspaces),
audited code-level by five parallel reviewers across the tab strip, decision/guard flows,
marking/connections, margin surfaces, and the visual layer. Verification at audit time:
lint clean, both builds clean, 993 tests / 964 pass / 0 fail / 29 expected ABI skips.

Intentional behaviors NOT flagged: Tab cycling study lenses from the reading canvas;
A14 breakpoint sprawl and A19 radial placement (deferred architecture items).

Cleared by the audit (checked, no gap found): six-theme `--workspace-*` variable coverage;
popover portaling vs. the tab bar's stacking context; tab label truncation; reduced-motion
and forced-colors blocks; the one-shared-VersePeek-controller model; margin panel ID reuse;
focus restoration on ConnectionCard/NoteCapture/palette exits; no fresh breakpoint sprawl
(new queries reuse the 760px boundary); no hardcoded colors bypassing variables.

---

## P0 — Trust breakers (the app fights or traps the user)

1. **Recovery-state draft traps the user with no escape.** A non-confirmed connection save
   puts the session in `recoveryState`; every exit (Escape, tab change, chapter change,
   window close) is refused with only a status line — no "Discard anyway."
   `src/renderer/components/MarkingSurface.tsx:1554-1559`.
   → Add a Discard-anyway affordance to the recovery state.

2. **`committed-pending` blocks navigation even though the work is saved.** "Safely
   recorded · Retry repairs its reading index" still refuses exit until the user re-runs
   the command. `MarkingSurface.tsx:1505-1512,1554`.
   → Treat committed-pending as leavable; repair the index in the background.

3. **Quit can silently no-op.** (a) A flush failure vetoes window close with no dialog and
   no force-quit path (`src/renderer/app.tsx:737-748`,
   `src/renderer/utils/workspacePersistence.ts:237-240`); (b) a recovery-state draft vetoes
   quit with the reason buried in a MarkingSurface status string (`workspaceTransition.ts:34-36`);
   (c) Cmd+Q during initial workspace load is vetoed silently (`workspacePersistence.ts:45`).
   → On any close veto, surface a window-level modal: reason + Retry / Quit without saving.

4. **Arrow keys on the tab strip use activation-on-focus.** Each arrow keystroke commits a
   full workspace transition — and for decision-gated tabs can pop a confirmation dialog on
   every intermediate tab while traversing. `ScriptureWorkspaceTabs.tsx:406-413`.
   → Switch to manual activation (roving focus on arrows, commit on Enter/Space), per APG
   guidance for tabs whose activation is expensive.

## P1 — Core-flow gaps (high value, contained fixes)

5. **Multi-phrase draft shows a count, not the phrases.** The rail renders "N phrases" with
   no reviewable list, and a mis-captured phrase cannot be removed individually — recovery
   is discard-everything. `MarkingSurface.tsx:614,1616-1624,2208-2236`.
   → List captured phrases in the session bar with a per-phrase remove (filter `anchors`).

6. **Cross-chapter connection activation is a silent no-op.** `handleSelectAuthoredConnection`
   filters anchors to the current book/chapter and returns early when none is local, so an
   Isaiah→Matthew connection's far end is unreachable from the list.
   `src/renderer/components/ScripturePage.tsx:3681-3710`.
   → Navigate to (or offer "Go to counterpart" for) off-chapter anchors.

7. **Precision refusals speak engineer.** Raw core messages ("cuts lexical fragment 3-7",
   "no canonical token occurrences") surface verbatim with no recovery instruction, and the
   Connect relationship buttons stay visually active but silently fail after a refusal.
   `ScripturePage.tsx:3302`, `src/core/annotations/occurrence-alignment.ts:411,418,431`,
   `MarkingSurface.tsx:1592-1595`.
   → Map issue codes to plain guidance ("Select whole words…") and reflect refused state on
   the connect affordances.

8. **Capacity limit is a cliff, not a gauge.** "+ Open" stays enabled at 64 tabs and fails
   after the fact via toast (`ScriptureWorkspaceTabs.tsx:554-564`,
   `workspaceCapacityFeedback.ts:16`); `move-entity-context` asks for confirmation *before*
   the capacity check, so a confirmed action can then be refused
   (`src/renderer/utils/studyWorkspace.ts:1186-1189`).
   → Show live count / disable at cap; run capacity checks before offering confirmations.

9. **Only the last closed item is restorable.** Ten closed studies are retained
   (`studyWorkspace.ts:229`) but the UI exposes only `recentlyClosed.at(-1)`
   (`ScriptureWorkspaceTabs.tsx:199`).
   → Expose the full stack as a "Recently closed" list in the overflow popover.

10. **Anti-forgery guard is indistinguishable from a broken button.** When the snapshot
    validation rejects a confirmed destructive decision, the outcome is `"unchanged"` and no
    toast or re-prompt follows — "Close study" visibly does nothing.
    `studyWorkspace.ts:1120-1136`, `app.tsx:1184-1190,1220-1227`.
    → Toast "Study changed — nothing was closed, try again" on post-confirm `unchanged`.

11. **Coarse-pointer targets miss the app's own 44px convention.** Tabs are 30px, close
    24×24, action buttons 28px, with no `any-pointer: coarse` override (pattern exists at
    `styles.css:5900,15751,17010,17026`); close buttons are also hover-revealed only, so
    no-hover devices can't close non-selected tabs from the strip.
    → Add a coarse-pointer block bumping targets to 44px and reveal close under `hover: none`.

## P2 — Experience polish (medium)

12. **No Undo after saving a connection**, while every highlight mutation offers one.
    `MarkingSurface.tsx:1517` vs `ScripturePage.tsx:2911`. → Parity Undo toast.

13. **Focus drops to `<body>` after non-cancel decision-dialog resolutions.**
    `WorkspaceDecisionDialog.tsx:145`, `app.tsx:1281-1304`. → Restore focus to the affected
    tab, mirroring `focusWorkspaceTabAfterCommit`.

14. **Group affordances are indirect.** The expanded group label is a non-interactive
    `::before` (`styles.css:1080-1091`); manage controls appear only for the *active* tab's
    group (`ScriptureWorkspaceTabs.tsx:530-553`); no right-click context menu; no
    drag-to-reorder — moves go through single-step `<select>` dropdowns
    (`ScriptureWorkspaceTabs.tsx:118-128,803-811`).
    → Interactive group headers with disclosure; tab/group context menu; pointer drag-reorder
    with selects kept as the keyboard fallback.

15. **Persistence failure is too quiet.** A small inline "Retry saving tabs" button inside an
    `aria-live="polite"` status span is the only signal of at-risk workspace state.
    `ScriptureWorkspaceTabs.tsx:517-529`, `styles.css:1325-1341`.
    → Promote to `role="alert"` with a persistent visible treatment; keep the button outside
    the live region.

16. **Escape on a one-phrase draft opens the full Discard/Keep modal** though nothing
    savable exists. `connectionDraftLifecycle.ts:11-15`, `MarkingSurface.tsx:2208-2235`.
    → Discard sub-two-phrase drafts directly on Escape.

17. **Tab system is invisible to the command palette.** Only six actions are registered
    (`app.tsx:1691-1728`); no reopen/close/rename/switch-study entries, and no Cmd+number
    jump (Ctrl+Tab exists at `app.tsx:1355-1357`).
    → Register tab-management palette actions; consider Cmd+1..9.

18. **Focus mode hides the strip but Ctrl+Tab still switches silently.**
    `ScripturePage.tsx:4596`. → Minimal on-switch indicator in focus mode.

19. **Vocabulary drift: "highlight" vs "wash."** Margin copy and toasts say highlight
    (`LivingMargin.tsx:2771,2959,3021`; `ScripturePage.tsx:2865,2911,2967`) while the
    marking UI says Wash (`MarkingSurface.tsx:154-167`). → Standardize reader-facing copy.

20. **Strip traversal is trackpad-only for mouse users.** Fixed-width non-shrinking tabs,
    hidden scrollbar, no scroll buttons. `styles.css:1031-1045,1098-1103`.
    → Left/right scroll affordances or shrinkable tabs.

21. **Draft rail is pinned to stage top** — far from the work when marking deep in a long
    chapter. `styles.css:15546-15551`, `MarkingSurface.tsx:618-624`.
    → Anchor near the most-recent capture or echo Save near the active phrase.

## P3 — Fit and finish (low)

22. Relationship click during pending capture is silently dropped — queue it or show busy.
    `MarkingSurface.tsx:1588-1591`.
23. Identical phrase quotes are indistinguishable in labels — add verse/position suffix.
    `MarkingSurface.tsx:1620,1471-1472`.
24. Post-activation emphasis has no transient landing cue (worst under reduced motion with
    no scroll). `ScripturePage.tsx:3699-3709`.
25. Home tab isn't visually pinned or marked; identifiable only by missing close button.
    `ScriptureWorkspaceTabs.tsx:436-514`, `studyWorkspace.ts:1074`.
26. Overflow "•••" hides the tab count (aria-label only) — add a numeric badge.
    `ScriptureWorkspaceTabs.tsx:578-598`.
27. "+ Open" tooltip promises a new tab but opens the palette — align copy or behavior.
    `ScriptureWorkspaceTabs.tsx:554-564`, `ScripturePage.tsx:4619`.
28. Strip close control is an `aria-hidden` span (Delete/Backspace only) while the overflow
    list uses a real button — make the affordances match.
    `ScriptureWorkspaceTabs.tsx:500-510` vs `:832-840`.
29. Focus rings on new controls use solid `--study-gold` where siblings use
    `--study-gold-focus`. `styles.css` (~428, ~1195 in the new block).
30. Selected-tab width snaps 92→112px untransitioned; tabs animate in but not out; no
    `:active` pressed states; decision-dialog hover untransitioned; tab-in animation
    hardcodes `150ms ease-out` instead of `--transition-fast`.
31. Unicode glyphs (⌄ ↶ ••• ⌕) instead of the stroke-SVG system used by tab marks/close.
    `ScriptureWorkspaceTabs.tsx:551,575,597,697`.
32. Overflow list scrollbar skips the thin-scrollbar group. `styles.css:~588` vs `635-669`.
33. Toasts stack unbounded and duplicate ConnectionCard inline feedback.
    `Toast.tsx:115`, `ScripturePage.tsx:4064,4126`.
34. Keyboard-opened VersePeek panel has no Tab focus trap. `VersePeek.tsx:151-166`.
35. Research margin lacks a scope live-region announcement (study margin has one).
    `LivingMargin.tsx:2626` vs `:2480-2534`.
36. NoteCapture blocked-save errors use `role="status"` instead of `role="alert"`.
    `NoteCapture.tsx:405`.
37. Passage-close dialog variants omit the "can be reopened from Recently closed"
    reassurance that `close-study` gives. `WorkspaceDecisionDialog.tsx:32,47,55`.
