# TASK D8: Desktop reading precision and research control

STATUS: LANDED — all four desktop contracts implemented and accepted on 2026-07-21.

## Landing evidence

- Active-package capture now round-trips through the canonical anchor before
  authoring. BSB Acts 19:2 `Holy Spirit` refuses visibly with zero event write;
  Acts 19:3 `baptism` and Acts 19:6 `Holy Spirit` remain exact.
- Passage lists share one canonical, passage-scoped comparator. Activating a
  Study row holds the connection, chooses the eye-line-nearest local anchor,
  and centers its selected bracket on the reading canvas.
- All four marking surfaces share the top draft rail and one guarded lifecycle.
  Chapter, translation, view, library, Escape, and the real Electron window
  close use the same Save/Discard/Keep decision; no timer exists.
- Scripture now has a persistent desktop workspace strip directly below its
  toolbar: one pinned Scripture tab plus passage-grouped Research tabs. Tabs
  retain their own entity trail and scroll, groups collapse or close together,
  and horizontal scroll plus a grouped overflow menu keeps large tab sets
  controlled without adding compact/mobile UI.
- Focused contracts pass; `npm run qa:desktop-reading-control` passes at one
  1180px desktop width with six concurrent Research tabs, group collapse,
  overflow, individual close, and group close; lint, Electron/renderer builds,
  and the full unit suite are green at 757 total / 728 pass / 29 expected ABI
  skips.

## Product decision

Desktop reading is the priority for this pass. Do not add new mobile-specific
features or a 390px acceptance matrix. A separate mobile edition can be scoped
later. Preserve the existing compact fallback, but judge this task at desktop
reading widths.

This task corrects four connected desktop failures without reopening route
geometry, visual themes, or the four marking-system designs:

1. a phrase must never silently grow after the reader selects it;
2. connections must read in canonical Scripture order and open visibly on the
   canvas;
3. a multi-phrase connection draft needs an obvious, safe completion model;
4. Study and Research need persistent workspace control, not only a Back
   button.

## Current-state findings

### Phrase precision

- `ScripturePage` initially captures the native DOM range as package-local
  character offsets. `MarkingSurface` keeps those exact fragments only while
  the draft is in flight.
- A durable connection stores translation-free `backbone-token:v1`
  occurrences. Reprojection can cover a wider target-language fragment than
  the native selection.
- A focused core probe of BSB Acts 19 proved one real widening: selecting
  `Holy Spirit` in Acts 19:2 (UTF-16 range 37–48) reprojects as
  `the Holy Spirit`. `baptism` in Acts 19:3 and `Holy Spirit` in Acts 19:6
  round-trip exactly. That one-token widening does not by itself explain every
  part of the reported “way more” paint, so the first implementation step must
  record the native quote, transient draft quote, and committed projection for
  the exact failing user gesture instead of guessing.
- Storing package character offsets on the anchor would violate INV-5. The
  immediate safe correction is therefore a round-trip guard: never commit a
  connection whose active-package projection silently adds lexical words.
  A future, finer translation-free coordinate layer is a separate architecture
  decision.

### Connection order and attention

- SQLite returns connections with `ORDER BY c.id`; the ULID is effectively
  authored history, not Scripture order.
- `LivingMargin` filters that array but does not sort it before rendering
  `Your connections`.
- Activating a list row calls `handleSelectConnection`, which selects the
  connection and reveals the inspector but does not choose an anchor or scroll
  the reading canvas. A valid selected bracket can therefore remain offscreen.

### Multi-phrase completion

- The shared `SessionStatus` currently says `N marked · select another phrase,
  or finish` and exposes generic `Done` / `Cancel` controls in the marking
  surface's bottom status area.
- Escape cancels a non-recovery session immediately. Chapter, translation,
  view, or app exit has no product-level Save/Discard/Stay decision for an
  otherwise saveable draft.
- An inactivity timer is rejected. Silence is ambiguous during study and must
  not become authored intent.

### Research control

- Canvas Back/Forward controls reading-navigation history.
- Entity research separately owns a Back button, Close action, and breadcrumb
  trail, but opening research replaces the Study margin until research is
  closed.
- The initially landed fixed `Study | Research` margin switcher retained one
  entity session, but it did not provide the desktop research control the human
  wanted. On 2026-07-21 the human explicitly amended this contract: Research is
  a first-class top-level workspace beside Scripture, with the strip directly
  below the Scripture toolbar and with clean handling for many tabs and tab
  groups. Mobile remains deferred.

## Goal 1 — Exact phrase round-trip

### Contract

- The native selected lexical words, transient connection-draft paint, and
  committed active-package paint must match.
- Whitespace and punctuation may normalize; lexical words may not be added or
  removed.
- Before a phrase enters a connection session, capture it to the canonical
  anchor and immediately project that anchor back into the active package.
- If the lexical ranges differ, keep the native selection visible and refuse
  the connection action with specific copy such as: `This translation cannot
  preserve those exact words yet. Adjust the selection or use a note/wash.`
- Never silently widen and never fall back to verse-level connection paint.
- Highlights and notes keep their existing package-exact behavior.

### Architecture follow-up, not part of this landing

If refusal rates are materially high, choose separately between:

1. a versioned translation-free selector finer than `backbone-token:v1`
   (preferred long-term, highest cost); or
2. an explicitly non-authoritative origin-package display clip outside the
   anchor (lower cost, but requires a human-approved INV-5 contract amendment
   and clear behavior when translations change).

### Acceptance

- Reproduce the user's exact Acts 19 `baptism` / `Holy Spirit` gesture and
  assert the three quotes: native, draft, committed.
- Exact selections save and repaint byte-for-byte at the lexical-word level.
- A widening selection is refused before any authored event is appended.
- Refusal leaves the native selection ready for adjustment and writes zero
  connection events.

## Goal 2 — Canonical connection order and canvas attention

### Contract

- Add one pure shared comparator for connections in a passage.
- Sort by the earliest intersecting anchor in canonical order:
  USFM book rank, chapter, verse start, verse end, first canonical occurrence,
  then connection id as the deterministic final tie-break.
- Anchor authoring order and connection creation time must not control the
  passage list.
- Use the comparator for `Your connections` and any other passage-level list;
  do not mutate durable anchor order.
- Activating a connection from the Study list must:
  1. select and hold the connection;
  2. choose its current-chapter attention anchor (closest to the settled
     eye-line, canonical order as the tie-break);
  3. scroll that verse into a comfortable center band;
  4. render its selected bracket/word emphasis on the next settled frame; and
  5. keep the connection inspector available without stealing the canvas back
     offscreen.
- Reduced motion uses an immediate scroll. Normal motion may use a short smooth
  scroll, but selected paint must not lag behind an obsolete viewport.

### Acceptance

- Seed connections in reverse creation order, including two in one verse;
  the visible list remains verse/word ordered.
- Clicking every list row makes one of that connection's anchors visible and
  paints exactly one selected bracket.
- A connection with no exact projection still scrolls to its passage anchor
  and shows the honest unavailable-exact state; it does not invent word paint.
- No event log bytes change from list activation.

## Goal 3 — Explicit multi-phrase draft lifecycle

### Contract

- Replace the easy-to-miss generic bottom status with one shared sticky desktop
  draft rail directly below the reading toolbar. All four marking systems use
  this same lifecycle component.
- With one phrase: `Series · 1 phrase` and `Select another phrase to connect.`
  Only `Cancel draft` is available.
- With two or more phrases: show `Series · N phrases`, a primary
  `Save connection` action, quiet guidance `Select more text to keep adding`,
  and trailing `Cancel draft`.
- Selecting more Scripture is always an in-session add operation. It must not
  trigger an exit prompt.
- No inactivity save, inactivity cancellation, or countdown.
- Context-destroying exits are chapter change, translation change, main-view
  change, library switch, window close, and explicit Escape from the draft.
- For a saveable draft (2+ phrases), those exits offer
  `Save connection | Discard draft | Keep editing`.
- For a one-phrase draft, those exits offer
  `Discard draft | Keep editing`; it cannot be saved as a connection.
- `Keep editing` returns focus to the reading canvas and preserves every exact
  draft phrase. `Discard` appends nothing. `Save` uses the existing explicit
  broker command and its current recovery semantics.

### Acceptance

- One phrase cannot be accidentally saved.
- After two phrases, the reader can save immediately or continue to a third
  without changing modes.
- Scroll, ordinary clicks, and new text selections never open the exit guard.
- Each destructive context exit opens the same guard and preserves the draft
  when `Keep editing` is chosen.
- Save appends one command; repeated Save during settlement cannot duplicate
  it; Discard appends zero bytes.

## Goal 4 — Persistent Scripture and grouped Research workspaces

### Contract

- Add a desktop-only workspace tablist directly below the Scripture toolbar,
  spanning the reading surface rather than living inside the margin.
- Keep one pinned `Scripture` tab. Its Study subject, lens, and scroll remain
  intact while Research is active.
- Each explicitly opened entity gets a Research tab with its own retained
  entity trail and margin scroll. Related-entity traversal updates the current
  tab's breadcrumb trail; it does not create a tab for every breadcrumb step.
- Group Research tabs by their opening passage/package origin. Groups expose a
  quiet count, collapse/expand control, and `Close group`; closing the active
  group returns to Scripture.
- Many tabs remain usable through horizontal scrolling and a grouped overflow
  menu. Persist at most 64 validated Research tabs so corrupt or runaway saved
  state cannot make startup unbounded.
- `+` opens the existing Names search rather than introducing a second search
  surface. Opening a result creates and selects its Research tab.
- Follow the WAI-ARIA Tabs pattern for the actual tabs: one tab stop,
  Left/Right wrapping, Home/End, correct `aria-selected`, `aria-controls`, and
  one labelled dynamic tab panel. Delete/Backspace closes a focused Research
  tab; Scripture cannot close.
- Reading-history Back/Forward remains passage history and is not overloaded
  with research-workspace switching.

### Acceptance

- Open multiple Research tabs, switch to Scripture, change a Study lens, and
  switch back: Scripture and every Research tab retain identity, trail, and
  scroll independently.
- Six Research tabs at 1180px remain reachable by direct tab or grouped
  overflow; group collapse/expand and individual/group close preserve a valid
  active workspace.
- Keyboard tab semantics match the APG pattern with no duplicate tab stops.
- This task adds no mobile-specific controls, breakpoints, or mobile matrix.

## Lean verification plan

Do not repeat the previous theme × surface × viewport exhaustion.

1. Pure focused tests only:
   - phrase round-trip/refusal;
   - canonical connection comparator;
   - draft exit-state reducer;
   - grouped Scripture/Research workspace-state reducer.
2. One contract test for the shared draft rail and workspace tab semantics.
3. One isolated desktop Electron scenario at a representative reading width:
   - exact Acts 19 phrase pair;
   - reverse-created connection ordering;
   - list-to-canvas attention;
   - add a third phrase, Save/Discard/Keep-editing exits;
   - Scripture ↔ multiple Research restoration, group collapse, and overflow.
4. Run lint, renderer/Electron builds, and the full unit suite once when the
   complete task lands.
5. Do not rerun route digests, all four marking-surface matrices, every theme,
   or mobile widths unless this task actually changes those contracts.

## Research basis

- WAI-ARIA APG Tabs Pattern:
  https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Apple Human Interface Guidelines — tab bars describe stable navigation
  sections and recommend fewer tabs:
  https://developer.apple.com/design/human-interface-guidelines/tab-bars
