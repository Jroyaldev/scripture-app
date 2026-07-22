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
- A premium-minimal single-row desktop strip.
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

## Unified state model

The renderer owns one versioned workspace state.

```ts
interface StudyWorkspaceStateV2 {
  version: 2;
  groups: StudyWorkspaceGroup[];
  tabs: StudyWorkspaceTab[];
  activeTabId: string;
  activationOrder: string[];
  recentlyClosed: ClosedStudyItem[];
}

interface StudyWorkspaceGroup {
  id: string;
  rootPassageTabId: string;
  tabIds: string[];
  lastActiveTabId: string;
  collapsed: boolean;
  label?: string;
}

type StudyWorkspaceTab = PassageWorkspaceTab | EntityWorkspaceTab;

interface PassageWorkspaceTab {
  kind: "passage";
  id: string;
  groupId: string;
  location: NavigationHistoryEntry;
  history: NavigationHistoryState;
}

interface EntityWorkspaceTab {
  kind: "entity";
  id: string;
  groupId: string;
  entityId: string;
  entityKind: "person" | "place" | "other";
  contextPassageTabId: string;
  origin: CommandReadingContext;
  trail: EntityResearchTrailEntry[];
  scrollTop: number;
  nonce: number;
}
```

`NavigationHistoryEntry` remains the canonical passage snapshot and is extended
only where necessary to retain the Study margin scroll. It already carries the
translation, reading eye-line, selected/kept scope, and active Study lens.

Every group has at least one passage tab. Its root passage supplies the default
group label (`Acts 19`) and the context for globally opened person/place tabs.
Additional passages and entities join the active group unless the user chooses
`New study group`.

## Passage-tab behavior

- Previous/Next chapter, plain Left/Right on the reading canvas, and the passage
  picker update the active passage tab in place and append to that tab's
  Back/Forward history.
- `Open passage in new tab` creates a passage tab in the active group. A
  modifier/middle-click on a Scripture reference invokes the same action.
- Selecting a passage tab restores its translation, chapter, verse eye-line,
  selected/kept scope, Study lens, Study scroll, and Back/Forward stacks.
- Back/Forward operates on the active passage tab. It is not a workspace-tab
  switcher.
- An ordinary Scripture reference inside a passage follows in that passage tab.
  An explicit new-tab action preserves the source for comparison.
- The final passage tab in the app cannot close. Its close affordance is absent,
  not disabled.
- Closing a group's root passage promotes the nearest remaining passage. If no
  other passage exists and entity tabs remain, a calm in-app confirmation
  offers `Close study` or `Keep open`; entities are never orphaned and no native
  dialog is used.

## Person/place behavior

- A person/place row in Study exposes one primary action named
  `Open research tab`. Plain row activation performs that action.
- The active passage tab becomes the entity tab's `contextPassageTabId`, and the
  entity joins the same study group.
- Opening the same entity with the same context focuses its existing tab.
  `Open duplicate` is an explicit context action rather than an accidental
  second copy.
- A related entity selected inside Research navigates the current entity tab,
  appends its visible breadcrumb/Back trail, and retains the tab's root context.
- A trailing `Open in new tab` action plus modifier/middle-click creates a
  sibling entity tab without changing the current trail.
- Selecting an entity tab restores its linked passage context on the canvas and
  its own entity trail/scroll in the margin.
- A Scripture reference selected inside an entity tab follows in its linked
  passage tab and selects that passage tab. An explicit new-tab action creates
  a sibling passage tab. References never mutate an unrelated hidden canvas.

## Creation and discoverability

The strip's `+` opens a compact **Open tab** popover; it never jumps directly
to one search mode.

1. `Open passage…` — focuses a reference field and shows recent passages.
2. `Research person or place…` — opens the existing Names index, with the two
   quiet glyphs taught in the result rows.
3. `New study group` — creates a group rooted in the current passage snapshot.

The passage picker and person/place rows also expose contextual new-tab actions,
so the plus menu is not the only discovery path. Tooltips and accessible names
use the same vocabulary: `Open tab`, `Open passage in new tab`, and
`Open research tab`.

## Group behavior

- Groups are durable, ordered, and manually meaningful; they are not inferred
  every render from `book:chapter:packageId`.
- A new group auto-labels from its root passage. `Rename study` is available in
  the group menu for labels such as `Sunday — Trinity` or `Romans series`.
- `Move to study` moves a tab through a deterministic menu. Moving an entity
  rebinds its context to the destination group's root passage. Moving a
  non-root passage retains its complete history; entity tabs left behind that
  referenced it rebind to their current group's root. A sole/root passage must
  first be duplicated in the destination or moved with the entire group.
- Expanded groups show readable tabs separated by a restrained boundary.
- Collapsing a group never activates global Scripture or another group. A
  collapsed proxy represents the group's `lastActiveTabId`, shows the group
  label and count, and remains a valid selectable tab.
- Closing a group uses the existing confirmation language when it contains
  more than one tab. At least one passage group always remains.
- Group disclosure controls are excluded from the tab roving set; Left/Right
  traverses only actual tabs/proxies.

## Closing, limits, and recovery

- Closing the active tab chooses the nearest tab in its group, then the group's
  root, then the most-recent tab in the nearest group.
- The last ten explicitly closed tabs/groups enter a bounded recently-closed
  stack. `Reopen closed tab` and `Cmd/Ctrl+Shift+T` restore the latest item.
- The workspace accepts at most 64 total tabs. Reaching the limit does not
  silently evict anything. The Open-tab popover explains `64 tabs open` and
  opens the searchable All Tabs manager.
- Duplicate passage identity is book, chapter, translation, and group. Normal
  opening focuses the duplicate; explicit `Open duplicate` bypasses reuse.
- Invalid/missing restored chapters fall back visibly to the group's root
  passage without deleting the stored tab. Missing entities retain a named
  unavailable tab that can be closed.

## Draft and mutation safety

- Switching to a tab whose linked passage differs, closing a passage/group, or
  changing translation uses the existing Save/Discard/Keep draft controller.
- Switching between entity tabs linked to the same passage is non-destructive
  and does not prompt.
- `Keep editing` restores focus to the originating reading canvas and leaves
  workspace state unchanged.
- Authored mutation recovery continues to block context changes. Workspace
  state is settings data and never writes Substrate autonomously.

## Keyboard and focus

- Left/Right, Home/End on the tablist follow the APG tabs pattern and activate
  already-loaded tabs immediately.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` traverse visible workspace tabs from anywhere
  outside text entry.
- Delete/Backspace closes a focused closable tab; `Cmd/Ctrl+W` closes the active
  tab when the app owns the shortcut.
- `Cmd/Ctrl+Shift+T` reopens the last closed tab.
- Plain Left/Right on the reading canvas remains Previous/Next chapter.
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
- The active tab gets one neutral material lift and one neutral baseline. Gold
  remains reserved for focus.
- The active tab receives enough width to remain readable; inactive tabs may
  compact before overflow. Close appears on hover, focus, or selection.
- Group labels, boundaries, count badges, edge fades, and collapsed proxies use
  neutral ink/material only. No categorical tab colors, halos, or stacked card
  silhouettes.
- Overflow is a searchable grouped switcher showing group, type, label, and
  current state. It is not a second permanently visible tab list.
- `All tabs` and `Open tab` use text in tooltips/accessibility names; icon-only
  controls are never the sole explanation of capability.
- Forced-colors mode removes masks and exposes full system outlines; reduced
  motion removes tab-entry and reorder animation.

## Persistence and migration

- Electron persists `studyWorkspace` as a validated version-2 settings object.
- Validation caps 64 total tabs, 16 groups, 50 history entries per passage,
  12 entity trail entries, and 10 recently closed records. Unknown cosmetic
  fields are dropped rather than rejecting the workspace.
- The current `researchWorkspace` migrates once: each origin becomes a group,
  a passage root is created from that origin, and its entity tabs retain order,
  trails, kinds, and nonce values. The current `lastRead` becomes or updates the
  active root passage.
- The legacy single `researchSession` remains readable for one migration cycle
  but is no longer written after version 2 settles.
- Migration never mutates authored data or event logs.

## Verification contract

### Pure state tests

- Passage open/reuse/explicit duplicate and in-place navigation.
- Per-tab Back/Forward isolation and restored passage snapshot.
- Entity open/reuse, related-entity in-place navigation, and explicit branch.
- Mixed group creation, rename, move, collapse proxy, close fallback, and root
  promotion.
- Limit refusal without eviction and recently-closed restoration.
- Version-1 migration plus strict version-2 normalization.

### Component contracts

- The Open-tab menu names both passage and person/place creation.
- Only real tabs/proxies participate in roving focus.
- Passage, person, and place accessible names match visible labels.
- Contextual actions expose current-tab versus new-tab consequences.
- Draft guards cover destructive passage/group changes.

### One real desktop Electron scenario

At one representative 1180px width:

1. Root the first study at Acts 19.
2. Open John 3 and Romans 6 as passage tabs.
3. Open Apollos and Ephesus from Acts 19.
4. Navigate Apollos to Priscilla in place; branch Ephesus explicitly.
5. Follow a cross-reference in the linked passage, Back, and verify the other
   passage tabs retain eye-line, lens, and selection.
6. Create and rename a second study group; move one passage into it.
7. Collapse both groups, reopen the active group, use searchable overflow, and
   close/reopen one tab.
8. Reload Electron and prove group order, tab order/type, active tab, linked
   passage, entity kinds/trails, and passage histories survive.
9. Capture a real-app screenshot with the dense grouped state visible.

Run the focused contracts during development, then lint, renderer/Electron
builds, the full unit suite once, and this bounded Electron path. Do not repeat
the theme × marking-surface × mobile matrices because this design does not
change those contracts.

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
