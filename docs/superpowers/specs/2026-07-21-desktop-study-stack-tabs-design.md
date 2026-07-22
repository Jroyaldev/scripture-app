# Desktop Study-Stack Tabs Design

**Status:** Design contract for the desktop workspace-tab goal, 2026-07-21.

This contract supersedes only Goal 4 of
`tasks/D8-desktop-reading-precision-and-research-control.md`. D8's phrase,
connection-order, canvas-attention, and marking-draft contracts remain intact.

## Problem

The current strip looks like a workspace system but models only entity research.
`Scripture` is one mutable canvas with one global navigation history, while each
person or place receives a durable tab grouped by the passage where it was
opened. This reverses the reader's real priority: passages are the primary
working set and people/places are supporting investigations.

It also produces inconsistent outcomes. A person/place selected from Study
opens a tab; a related entity selected inside Research mutates that tab or
silently switches to a duplicate; a Scripture reference can change the shared
canvas behind the entity tab. The bare `+` opens Names only, so neither passage
tabs nor the way to add research are discoverable.

The finished system must make its visual metaphor true without becoming a
general-purpose browser or a multi-pane layout manager.

## Product purpose

The desktop strip is a study bench for returning to a small set of passages and
their supporting investigations during sermon, lesson, series, or lectionary
preparation.

- A **tab** is a durable return point.
- Back/Forward records steps taken **inside that tab**.
- A **group** is the study question those tabs serve.
- A plain activation follows the current line of inquiry.
- An explicit new-tab action branches without losing the source.

The system renders one reading canvas and one Living Margin. Durability comes
from restoring tab state, not keeping many readers mounted.

## Scope

### Included

- First-class passage tabs with rapid switching and independent history.
- Person/place tabs linked to the passage that prompted them.
- Meaningful ordered study groups containing mixed passage and entity tabs.
- Clear creation, duplicate handling, closing, restoration, overflow, keyboard,
  persistence, migration, and draft-exit behavior.
- A premium-minimal single-row desktop strip with a stable material in all six
  existing themes.
- One bounded real-Electron acceptance path based on pastoral workflows.

### Excluded

- New mobile controls or a mobile acceptance matrix.
- Multiple simultaneously mounted reading canvases or resizable panel layouts.
- Resource/commentary tabs, sync, collaborative workspaces, or saved layout
  templates.
- Drag-and-drop tab rearrangement in the first landing. Deterministic context
  actions are sufficient.

## Pastoral workflows

1. **Weekly exegesis:** keep Acts 19, John 3, and Romans 6 available while
   examining Apollos and Ephesus; every return restores the exact reading place.
2. **Sequential series:** Previous/Next changes Acts 18 to Acts 19 in the same
   passage tab; an explicit branch keeps Acts 20 for next week.
3. **Lectionary preparation:** Isaiah 6, Psalm 138, 1 Corinthians 15, and Luke 5
   coexist in one Sunday group rather than being auto-split by origin.
4. **Entity investigation:** Apollos can lead to Priscilla in place; Ephesus can
   be opened as a deliberate parallel branch.
5. **Cross-reference chase:** Romans 8 can follow Psalm 44 and Genesis 3 inside
   one passage tab's Back/Forward history, while explicit new tabs preserve
   comparison passages.
6. **Resume after interruption:** ordered groups, active tabs, entity trails,
   reading eye-lines, and recently closed tabs survive the expected lifecycle.

### Multi-persona audit result

The model was checked against weekly exposition, sequential-series planning, a
four-reading lectionary Sunday, small-group teaching, pastoral-care note work,
keyboard-only use, low-vision/themed use, and interruption/restart. The model
holds if the implementation preserves these cross-persona constraints:

- A group is an active study question, not a sermon archive or an incidental
  bucket created by every chapter change.
- Each entity keeps immutable opening provenance while owning a separate current
  canvas session. Following its references never mutates a hidden passage tab.
- Same-reference translations and repeated entity names remain distinguishable.
- Every authored draft/recovery owner can veto a tab, group, or chapter change.
- Workspace persistence contains navigation metadata only; it never copies note
  bodies, note quotes, surfaced-note titles, or search queries.
- Focus mode hides the strip, and the strip remains fully usable without color,
  translucency, pointer hover, or fine motor precision.

## Unified state model

The renderer owns one versioned workspace state.

```ts
interface StudyWorkspaceStateV2 {
  version: 2;
  groups: StudyWorkspaceGroup[];
  tabsById: Record<string, StudyWorkspaceTab>;
  activeTabId: string;
  activationOrder: string[];
  recentlyClosed: ClosedStudyItem[];
}

interface StudyWorkspaceGroup {
  id: string;
  homePassageTabId: string;
  tabIds: string[];
  lastActiveTabId: string;
  collapsed: boolean;
  label:
    | { kind: "automatic"; frozenReference?: { book: string; chapter: number } }
    | { kind: "custom"; value: string };
}

type StudyWorkspaceTab = PassageWorkspaceTab | EntityWorkspaceTab;

interface PackageSelectionSnapshot {
  packageId: string;
  pieces: Array<{
    verse: number;
    charStart: number | null;
    charEnd: number | null;
  }>;
}

type ClosedStudyItem =
  | { kind: "tab"; tab: StudyWorkspaceTab; index: number }
  | { kind: "group"; group: StudyWorkspaceGroup; tabsById: Record<string, StudyWorkspaceTab>; index: number };

interface PassageWorkspaceSession {
  current: PassageViewState;
  history: {
    back: PassageViewState[];
    forward: PassageViewState[];
  };
}

interface PassageViewState extends NavigationHistoryEntry {
  selection?: PackageSelectionSnapshot;
  margin: NavigationHistoryEntry["margin"] & {
    scrollTopByTab: Partial<Record<NavigationMarginTab, number>>;
    wordsVerse?: number;
    wordsFollowingReading: boolean;
  };
}

interface PassageWorkspaceTab {
  kind: "passage";
  id: string;
  groupId: string;
  session: PassageWorkspaceSession;
}

interface EntityWorkspaceTab {
  kind: "entity";
  id: string;
  groupId: string;
  entityId: string;
  entityKind: "person" | "place" | "other";
  origin: PassageViewState;
  originRange?: { start: number; end: number };
  canvas: PassageWorkspaceSession;
  returnPassageTabId: string | null;
  trail: EntityResearchTrailEntry[];
  scrollTop: number;
  nonce: number;
}
```

`groups` and each group's `tabIds` are the canonical group/tab order.
`tabsById` is record storage only. Normalization drops unreferenced tab records,
removes missing/duplicate `tabIds`, rejects a group without a passage, repairs
`homePassageTabId`/`lastActiveTabId` to a referenced tab, and then repairs the
global active/activation order. Recently closed snapshots are JSON-safe and use
array order rather than wall-clock time.

`NavigationHistoryEntry` remains the base passage snapshot. `PassageViewState`
adds the meaningful state currently held only in component memory: an exact
package-local selection snapshot, per-lens Study scroll, the engaged Words
verse, and whether Words follows reading. It deliberately excludes hover,
expanded cards, fetched prose, and note contents.

Every group has at least one passage tab. Its home passage is the close fallback
and the seed used only when no active canvas exists; it is not universal entity
context. A one-passage automatic label follows that passage while the group is
still pristine. The first branch/entity addition freezes the current reference
as that study's automatic identity; a custom label is always stable. Additional
passages and entities join the active group unless the user explicitly starts a
new study.

## Passage-tab behavior

- The pinned global `Scripture` tab is retired. Passage tabs are Scripture; at
  least one passage tab always remains.
- Previous/Next chapter, plain Left/Right on the reading canvas, and the passage
  picker update the active tab's own canvas session in place and append to that
  session's Back/Forward history. They never create a tab and never mutate a
  hidden passage tab.
- On an entity tab those controls update only the entity's current canvas while
  its Research margin and immutable opening provenance remain intact. The
  research header distinguishes `Opened from Acts 19` from the current
  `Viewing Romans 6` when they differ.
- The chapter controls expose an explicit `Open previous/next chapter in new
  tab` action for series preparation.
- `Open passage in new tab` creates a passage tab in the active group. A
  modifier/middle-click on a Scripture reference invokes the same action.
- Selecting a passage tab restores its translation, chapter, verse eye-line,
  exact phrase/verse scope, kept scope, Study lens and per-lens scroll, Words
  verse/follow state, and Back/Forward stacks.
- Back/Forward operates inside the active tab's canvas session. The visible
  Research breadcrumb Back remains the entity-trail control; neither control is
  a workspace-tab switcher.
- Existing reference controls that first open VersePeek keep that preview
  behavior. Their explicit `Follow passage` action navigates the active canvas;
  `Open passage tab` preserves the source for comparison, and `Keep in Study`
  continues to change only the Living Margin scope.
- Opening a verse range whose chapter/translation already has a normal tab
  focuses that tab and navigates it to the requested range, recording history.
  Retaining two independent ranges in the same chapter requires explicit
  duplication.
- Passage accessible names and All Tabs always include translation. A quiet
  visible suffix (`Acts 19 · WEB`, `Acts 19 · KJV`) appears only while
  same-reference translations would otherwise collide.
- Duplicate prevention applies to structural creation: normal `Open passage`
  focuses an existing same-group book/chapter/translation tab, while explicit
  `Open duplicate` creates another. Navigation inside an existing tab—arrows,
  picker, Back/Forward, range follow, or translation change—never merges or
  discards histories, even if two tabs temporarily converge on the same
  identity. Tooltips and All Tabs disambiguate converged tabs by group and
  recent history.
- The final passage tab in the app cannot close. Its close affordance is absent,
  not disabled.
- Closing a passage with no dependent research closes directly. With dependents,
  one calm in-app prompt offers `Close passage and research`, `Keep research`,
  or `Cancel`; keeping research clears only its return pointer, and its immutable
  origin can later recreate/reuse the passage. If the passage was home, the
  nearest remaining passage is promoted. If it was the group's only passage,
  the only valid choices are `Close study` or `Keep open`. No native dialog is
  used and every outcome preserves the at-least-one-passage invariant.

## Person/place behavior

- A person/place row in Study exposes one primary action named
  `Open research tab`. Plain row activation performs that action.
- The active tab's full canvas snapshot is copied into both the entity's
  immutable `origin` and its independent current `canvas`; the originating
  passage tab becomes `returnPassageTabId`. The entity joins the same study.
- Entity reuse key is exactly group, entity ID, origin book/chapter/package, and
  `originRange`. It excludes eye-line, scroll, lens, and selection.
  The same biblical person opened from a different keyed passage is a valid
  separate investigation.
  `Open duplicate` is an explicit context action rather than an accidental
  second copy.
- A related entity selected inside Research navigates the current entity tab,
  appends its visible breadcrumb/Back trail, and retains its opening provenance.
- A trailing `Open in new tab` action plus modifier/middle-click creates a
  sibling entity tab without changing the current trail.
- Selecting an entity tab restores its own current canvas session and its entity
  trail/scroll in the margin. Its immutable origin remains available for
  `Return to Acts 19` even if the source passage tab later navigates elsewhere.
- A Scripture reference selected inside an entity tab updates that entity's
  canvas and brings the reference into attention while keeping Research
  visible. `Open as passage tab` creates/focuses a sibling passage tab instead.
- If the return passage tab was closed, `Return` creates or reuses a passage tab
  from the immutable origin; it never silently retargets the entity.
- Moving an entity preserves its immutable origin and copies/reuses the matching
  context passage in the destination group. Moving a passage with dependent
  entity tabs moves that branch atomically. No move, close, or root promotion
  silently rebinds research to an unrelated passage.
- A move-to-study action may preserve a branch before close. There is no
  implicit orphan cleanup or hidden retargeting.
- Repeated names are disambiguated in tooltips and All Tabs with type, opening
  passage, and translation (`Mary · person · from John 2 · BSB`).
- VersePeek's `Keep in Study` continues to freeze the Living Margin subject. It
  is not tab creation; `Open passage tab` is the explicit branching vocabulary.

## Creation and discoverability

At normal desktop width the strip shows `+ Open`; it may collapse to an icon
only after labels need the space. It opens a compact **Open tab** popover and
never jumps directly to one search mode. The heading states the destination,
for example `Add to Sunday — Trinity`.

1. `Open passage in this study…` — focuses a reference field and shows recent
   passages.
2. `Research person or place…` — opens the existing Names index, with the two
   quiet glyphs taught in the result rows.
3. `Start new study from Acts 19` — copies the active canvas snapshot into a new
   home passage; it never moves the source tab or silently copies an entity.

The passage picker and person/place rows also expose contextual new-tab actions,
so the plus menu is not the only discovery path. Tooltips and accessible names
use the same vocabulary: `Open tab`, `Open passage in new tab`, and
`Open research tab`.

## Group behavior

- Groups are durable, ordered, and manually meaningful; they are not inferred
  every render from `book:chapter:packageId`.
- Groups are the active bench for a sermon, lesson, series, or question—not an
  archive. Permanent sermon filing and saved layouts remain separate products.
- A pristine one-passage automatic label follows its home passage. The first
  branch/entity addition freezes that reference as the group's automatic study
  identity. `Rename study` creates a stable custom label such as
  `Sunday — Trinity` or `Romans series`.
- `Move to study` moves a tab through a deterministic menu using the provenance
  rules above. A sole/home passage must move with its whole group or first be
  duplicated in the destination.
- New tabs insert immediately after their source. Group and tab menus provide
  deterministic `Move left`, `Move right`, `Move to start`, and `Move to end`
  actions; drag-and-drop remains deferred.
- Expanded groups show readable tabs separated by a restrained boundary.
- Collapsing a group never activates another group. A
  collapsed proxy represents the group's `lastActiveTabId`, shows the group
  label and count, and remains a valid selectable tab.
- Closing a group uses the existing confirmation language when it contains
  more than one tab. At least one passage group always remains.
- Group disclosure controls are excluded from the tab roving set; Left/Right
  traverses only actual tabs/proxies. The DOM uses one `role="tablist"` containing
  actual tabs, collapsed proxies, and non-interactive presentation labels only.
  The active group's management button lives in the sibling actions rail;
  management for any group is also available in All Tabs. No arbitrary button
  is interspersed in the tab composite.

## Closing, limits, and recovery

- Closing the active tab chooses the nearest tab in its group, then the group's
  home passage, then the most-recent tab in the nearest group.
- The last ten explicitly closed tabs/groups enter a bounded recently-closed
  stack. `Reopen closed tab` and `Cmd/Ctrl+Shift+T` restore the latest item.
- Recently closed metadata contains only tab/group identity and navigation
  state—never note content, note titles, quotes, or search queries.
- The workspace accepts at most 64 total tabs. Reaching the limit does not
  silently evict anything. The Open-tab popover explains `64 tabs open` and
  opens the searchable All Tabs manager.
- The workspace accepts at most 16 groups. Starting or reopening a group at the
  limit refuses without mutation, says `16 studies open`, and opens All Tabs so
  the reader can close one first. A recently closed group remains recoverable
  until its bounded record ages out.
- Structural passage identity is book, chapter, translation, and group. Normal
  opening focuses the duplicate; explicit `Open duplicate` bypasses reuse.
- Invalid/missing restored chapters fall back visibly to the group's home
  passage without deleting the stored tab. Missing entities retain a named
  unavailable tab that can be closed.

## Draft and mutation safety

- One workspace-transition gate covers switching, closing, moving, group
  collapse, translation/chapter changes, and app/library/view exit.
- The gate asks every authored owner: marking/connection draft, note capture or
  edit, dirty connection card, in-flight mutation, and recovery state. Existing
  surface-specific Save/Discard/Keep language remains authoritative; the tab
  system does not invent an implicit save or generic destructive shortcut.
- A transition with no dirty owner proceeds immediately. Merely switching
  between clean tabs never prompts.
- `Keep editing` restores focus to the originating reading canvas and leaves
  workspace state unchanged.
- Authored mutation recovery continues to block context changes. Workspace
  state is settings data and never writes Substrate autonomously.
- Global tab shortcuts are inert while text entry, a dialog, popover, recovery
  layer, or another registered Escape/keyboard owner is active.

## Keyboard and focus

- Left/Right, Home/End on the tablist follow the APG tabs pattern and activate
  already-loaded tabs immediately.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` traverse visible workspace tabs from anywhere
  outside text entry.
- Delete/Backspace closes a focused closable tab; `Cmd/Ctrl+W` closes the active
  tab when the app owns the shortcut.
- `Cmd/Ctrl+Shift+T` reopens the last closed tab.
- Plain Left/Right on the reading canvas remains Previous/Next chapter.
- The workspace strip participates in the existing F6 pane cycle, and the
  Shortcuts overlay names tab traversal, close, and reopen commands.
- Activation from the strip leaves focus on the selected tab. Tab enters the
  panel. Opening research from content may move focus to its heading once; a
  later tab switch does not steal focus back into the margin.
- Close, collapse, restore, and overflow selection always land focus on a valid
  visible tab or the triggering control.

## Premium-minimal visual contract

- Preserve one 36–40px strip directly below the Scripture toolbar. Do not add a
  second toolbar row.
- Passage labels are references (`Acts 19`); research labels are names
  (`Apollos`, `Ephesus`). Person/place glyphs remain quiet single-stroke marks.
- Define resolved `--workspace-bar-bg` and `--workspace-active-bg` tokens for
  Paper, Ink, Glass, Candlelight, Porcelain, and Onyx. Paint the rail material
  once. No background beneath text may mix an already-translucent theme token
  with `transparent`.

  ```css
  /* Paper */       --workspace-bar-bg: #F7F1E6; --workspace-active-bg: #FCF8EF;
  /* Ink */         --workspace-bar-bg: #13110E; --workspace-active-bg: #1D1915;
  /* Glass */       --workspace-bar-bg: rgba(250,246,238,.78); --workspace-active-bg: rgba(255,252,246,.92);
  /* Candlelight */ --workspace-bar-bg: rgba(25,21,18,.80); --workspace-active-bg: rgba(45,37,31,.94);
  /* Porcelain */   --workspace-bar-bg: #F7F7F9; --workspace-active-bg: #FFFFFF;
  /* Onyx */        --workspace-bar-bg: #18181B; --workspace-active-bg: #232326;
  ```
- Glass and Candlelight apply the same blur/saturation treatment as the topbar.
  Action controls sit directly on the rail material; no second translucent
  gradient or pseudo-element is layered behind scrolled labels.
- The active tab gets one neutral active material and one solid
  `var(--text-secondary)` baseline. It does not also receive an inset border and
  shadow. Gold remains reserved for a solid, 3:1-safe keyboard focus outline.
- The active tab receives enough width to remain readable; inactive tabs may
  compact before overflow. Close appears on hover, focus, or selection.
- Tab labels use approximately 12px UI text; human-readable group labels use at
  least 10.5–11px UI text rather than 9px mono. Close targets are at least
  24×24px, and type glyphs render at full tertiary contrast rather than reduced
  opacity.
- Group labels, boundaries, count badges, edge fades, and collapsed proxies use
  neutral ink/material only. No categorical tab colors, halos, or stacked card
  silhouettes.
- Expanded groups do not repeat count badges. Counts belong on collapsed
  proxies and in All Tabs.
- Overflow is a searchable grouped switcher showing group, type, label, and
  current state. It is not a second permanently visible tab list.
- All Tabs opens on its search field or active row, never a destructive group
  action. Overflow appears from measured clipping, not a hard tab count.
- Scroll continuation uses a non-interactive edge curtain/divider painted in
  the rail material. It never masks or lowers the opacity of label glyphs.
- `All tabs` and `Open tab` use text in tooltips/accessibility names; icon-only
  controls are never the sole explanation of capability.
- Forced-colors mode uses `Highlight`/`HighlightText` for selection, exposes a
  system-color focus outline and group keyline, and removes masks. Reduced
  motion removes tab-entry, reorder, and disclosure rotation animation.

## Persistence and migration

- Electron persists `studyWorkspace` as a validated version-2 settings object.
- Validation caps 64 total tabs, 16 groups, 50 history entries per passage,
  12 entity trail entries, and 10 recently closed records. Unknown cosmetic
  fields are dropped rather than rejecting the workspace.
- A valid version-2 `studyWorkspace` is authoritative. `lastRead`,
  `keptContext`, and the unversioned legacy `researchWorkspace` never overwrite
  it after reload; `lastRead` may remain a compatibility mirror of the active
  canvas only.
- Without valid version 2, migration creates the first/home passage from valid
  `lastRead` (or the existing Acts 19 default), copies legacy `keptContext` into
  that passage's margin scope, and then stops writing the global kept setting.
  Each unversioned research origin becomes/reuses a group with a home passage;
  entity order, trails, kinds, and nonce values survive. If legacy state names
  an active research tab it remains active; otherwise the `lastRead` passage is
  active. A different `lastRead` origin creates a separate first group rather
  than rewriting a legacy origin.
- The legacy single `researchSession` remains readable for one migration cycle
  but is no longer written after version 2 settles.
- Migration never mutates authored data or event logs.
- Persist after every structural mutation and debounce only high-frequency view
  snapshots, with a close-time flush. A settings write failure leaves the live
  workspace intact, reports a calm retryable status, and never overwrites the
  last valid saved object with a partial record.
- Reload validates every tab but hydrates/fetches only the active tab. Inactive
  tabs remain metadata until selected, so a 64-tab workspace cannot trigger 64
  background research requests.
- Workspace and recently-closed records contain references, package IDs, entity
  IDs, view state, and intentional group labels only. All Tabs search indexes
  those labels—not note/search content. Product copy encourages study names,
  not counselee names; shared-device locking is a separate architecture item.

## Verification contract

### Pure state tests

- Passage open/reuse/explicit duplicate and in-place navigation.
- Per-tab Back/Forward isolation and restored exact passage/Words/Study state.
- Entity open/reuse, related-entity in-place navigation, and explicit branch.
- Immutable entity origin plus independent canvas navigation and safe return.
- Mixed group creation, rename, move, collapse proxy, close fallback, and home
  promotion.
- Automatic-label follow/freeze behavior, deterministic reorder, translation
  collision, same-chapter range reuse, and dependent-branch moves.
- Limit refusal without eviction and recently-closed restoration.
- Version-1 migration plus strict version-2 normalization.

### Component contracts

- The Open-tab menu names both passage and person/place creation.
- Only real tabs/proxies participate in roving focus.
- Passage, person, and place accessible names match visible labels.
- Contextual actions expose current-tab versus new-tab consequences.
- Draft guards cover destructive changes for every authored/recovery owner.
- All Tabs initial focus is non-destructive; F6 and shortcut suppression hold.

### One real desktop Electron scenario

At one representative 1180px width:

1. Root the first study at Acts 19.
2. Open John 3 and Romans 6 as passage tabs.
3. Open Apollos and Ephesus from Acts 19.
4. Navigate Apollos to Priscilla in place; branch Ephesus explicitly.
5. Follow a cross-reference inside Apollos, Back, and verify Research stays
   visible while all other passage tabs retain eye-line, lens, Words state, and
   exact selection.
6. Create and rename a second study group; move one passage into it.
7. Collapse both groups, reopen the active group, use searchable overflow, and
   close/reopen one tab.
8. Reload Electron and prove group order, tab order/type, active tab, linked
   passage, entity kinds/trails, and passage histories survive.
9. Capture a real-app screenshot with the dense grouped state visible.

### Bounded material/accessibility sweep

Capture the same deterministic 1180×900 stress state once in each of the six
themes: one named expanded group, one collapsed group, two passages (including a
translation collision), one person, one place, one long label, an active entity,
and All Tabs visible. Add one forced-colors interaction pass plus computed checks
for the focus indicator and 24px targets. This six-image bar sweep directly tests
the reported defect without multiplying themes across marking surfaces or mobile
viewports.

Run the focused contracts during development, then lint, renderer/Electron
builds, the full unit suite once, this bounded Electron path, and the six-image
bar-only theme sweep. Do not repeat the theme × marking-surface × mobile matrices
because this design does not change those contracts.

## Research basis

- Logos separates resources/tabs that can follow one another from saved layouts
  that preserve a coherent workspace:
  https://support.logos.com/hc/en-us/articles/360016827711-How-to-Link-Resources-to-Scroll-Together
  and
  https://support.logos.com/hc/en-us/articles/360016599631-Set-Up-Your-Workspace-with-Layouts
- Logos Passage Guide treats people and places as evidence supporting a passage
  rather than replacing the passage:
  https://support.logos.com/hc/en-us/articles/360016462872-Studying-a-Passage-Using-the-Passage-Guide
- Olive Tree's Study Center retains each supporting tab's place while the Bible
  remains the primary reading surface:
  https://help.olivetree.com/hc/en-us/articles/29762580603021
