import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as commandPaletteModule from "../src/renderer/components/CommandPalette.js";

const repoRoot = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(repoRoot, "src/renderer/app.tsx"), "utf8");
const palette = readFileSync(
  resolve(repoRoot, "src/renderer/components/CommandPalette.tsx"),
  "utf8",
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}

test("the shared palette presents destination-aware study-tab choices", () => {
  const studyTabOpenChoices = (commandPaletteModule as Record<string, unknown>).studyTabOpenChoices;
  assert.equal(typeof studyTabOpenChoices, "function");
  if (typeof studyTabOpenChoices !== "function") return;
  assert.deepEqual(
    (studyTabOpenChoices("Acts 19 study") as Array<{ id: string; title: string }>)
      .map(({ id, title }) => ({ id, title })),
    [
      { id: "open-passage", title: "Open passage in this study" },
      { id: "research-entity", title: "Research a person or place" },
      { id: "duplicate-passage", title: "Duplicate current passage" },
      { id: "start-study", title: "Start and name a new study" },
    ],
  );
  assert.match(palette, /mode\?: "search" \| "open-study-tab"/);
  assert.match(palette, /studyLabel\?: string/);
  assert.match(palette, /onOpenPassage:/);
  assert.match(palette, /onDuplicatePassage:/);
  assert.match(palette, /onStartStudy:/);
  assert.match(palette, /mode === "open-study-tab"/);
  assert.match(palette, /Add to \{studyLabel\}/);
});

test("study-tab mode exposes only destinations that can be added to a study", () => {
  const commandPaletteTabs = (commandPaletteModule as Record<string, unknown>).commandPaletteTabs;
  assert.equal(typeof commandPaletteTabs, "function");
  if (typeof commandPaletteTabs !== "function") return;
  assert.deepEqual(commandPaletteTabs("open-study-tab"), [
    { id: "intelligence", label: "Add" },
    { id: "scripture", label: "Passages" },
    { id: "names", label: "People & places" },
  ]);
  assert.deepEqual(commandPaletteTabs("search"), [
    { id: "intelligence", label: "Intelligence" },
    { id: "scripture", label: "Scripture" },
    { id: "notes", label: "My notes" },
    { id: "names", label: "Names" },
  ]);
  assert.match(palette, /const visibleTabs = commandPaletteTabs\(mode\)/);
  assert.match(palette, /visibleTabs\.map/);
});

test("ordinary palette Scripture navigation stays in the active canvas owner", () => {
  const navigate = section(app, "const handleNavigateToRef", "const consumeNavigateRef");
  assert.match(navigate, /const ownerTabId = studyWorkspaceRef\.current\?\.activeTabId/);
  assert.match(navigate, /setNavigateRef\(\{ ownerTabId, book, chapter, verse, endVerse, preapproved: true \}\)/);
  assert.doesNotMatch(navigate, /activateStudyCanvasOwnerPassageTab/);
  assert.doesNotMatch(navigate, /closeStudyWorkspaceTab/);
});

test("explicit passage opens, duplicates, and new studies are structural outcomes", () => {
  const openPassage = section(app, "const openPassageTab", "const duplicateActivePassageTab");
  assert.match(openPassage, /openPassageWorkspaceTab/);
  assert.match(openPassage, /result\.outcome === "opened" \|\| result\.outcome === "focused"/);
  assert.match(openPassage, /\.then\(\(proceed\) => \{[\s\S]*return proceed && accepted/);

  const duplicate = section(app, "const duplicateActivePassageTab", "const startStudyFromCurrentCanvas");
  assert.match(duplicate, /duplicate: true/);
  assert.match(duplicate, /openPassageWorkspaceTab/);
  assert.match(duplicate, /openedTabId = accepted \? result\.state\.activeTabId : null/);
  assert.match(duplicate, /proceed && accepted && openedTabId/);
  assert.match(duplicate, /focusWorkspaceTabAfterCommit\(openedTabId\)/);

  const startStudy = section(app, "const startStudyFromCurrentCanvas", "const openEntityResearchAt");
  assert.match(startStudy, /createStudyWorkspaceGroup/);
  assert.match(startStudy, /result\.outcome === "opened"/);
  assert.match(startStudy, /openedTabId = accepted \? result\.state\.activeTabId : null/);
  assert.match(startStudy, /openedGroupId = accepted \? result\.state\.tabsById\[result\.state\.activeTabId\]\?\.groupId \?\? null : null/);
  assert.match(startStudy, /proceed && accepted && openedTabId/);
  assert.match(startStudy, /focusWorkspaceTabAfterCommit\(openedTabId\)/);
  assert.match(startStudy, /openWorkspaceGroupNamingAfterCommit\(openedGroupId\)/);
});

test("destination focus is deferred and refuses to steal focus from a newer active tab", () => {
  const focus = section(app, "const focusWorkspaceTabAfterCommit", "const openPassageTab");
  assert.match(focus, /window\.setTimeout/);
  assert.match(focus, /studyWorkspaceRef\.current\?\.activeTabId !== tabId/);
  assert.match(focus, /document\.getElementById\(`study-workspace-tab-\$\{tabId\}`\)/);
  assert.match(focus, /focus\(\{ preventScroll: true \}\)/);
});

test("a new study is invited to name itself on its own chip", () => {
  /* THIS USED TO ASSERT A DOM HANDSHAKE, and it is restated rather than
     relaxed because the handshake is gone, not merely moved. The two lines that
     stood here were

       assert.match(naming, /querySelector<HTMLButtonElement>\('\[data-study-active-group-manage\]'/);
       assert.match(naming, /manage\?\.click\(\)/);

     — the app finding the strip's Manage control by selector and clicking it,
     which opened a dialog over the page to ask the reader for four words. The
     Manage control left the strip on 2026-07-30 with the rest of a study's
     identity, so the selector had nothing to find; and a handshake made of a
     selector fails silently when the element it names is renamed, which is
     exactly how the QA gate's own copy of this trick went a day pointing at a
     retired kicker.

     The invitation is a REQUEST now — a group id and a nonce, handed to the
     study line, which turns that study's chip into its own field where the name
     will be read. The nonce is load-bearing: two studies made in a row must be
     two invitations, and a bare id would look unchanged.

     What the test is for is untouched and is asserted below: a study created
     from the current canvas asks to be named at once, and the naming step
     refuses to seize focus if the reader has already gone somewhere else. */
  const naming = section(app, "const openWorkspaceGroupNamingAfterCommit", "const openPassageTab");
  assert.match(naming, /const current = studyWorkspaceRef\.current/);
  assert.match(naming, /current\?\.tabsById\[current\.activeTabId\]\?\.groupId !== groupId/);
  assert.match(naming, /setStudyNamingRequest\(\{ groupId, nonce: studyNamingNonceRef\.current \}\)/);
  assert.doesNotMatch(naming, /querySelector|\.click\(\)/,
    "the naming step is a request the study line answers, not an element it clicks");
  assert.match(app, /studyNamingRequest=\{studyNamingRequest\}/,
    "and the request reaches the study line");
  assert.match(app, /onStartStudy=\{startStudyFromCurrentCanvas\}/,
    "the study line's plus reuses the palette's own create-a-study path");
  assert.match(palette, /Create a separate sermon, question, or class study/);
});

test("the tab-bar plus opens the shared palette without issuing content focus", () => {
  assert.match(app, /setCommandMode\("open-study-tab"\)/);
  assert.match(app, /onOpenResearchPalette=\{openStudyTabCommandPalette\}/);
  assert.match(app, /onOpenEntity=\{openCommandEntityResearch\}/);
  assert.match(app, /openEntityResearchAt\(target, commandContext, "tab", undefined, false\)/);
  assert.match(app, /if \(requestFocus/);
});

test("App observes workspace persistence status and exposes retry", () => {
  assert.match(app, /const \[workspacePersistenceStatus, setWorkspacePersistenceStatus\]/);
  assert.match(app, /persistence\.subscribe\(setWorkspacePersistenceStatus\)/);
  assert.match(app, /const retryWorkspacePersistence = useCallback/);
  assert.match(app, /workspacePersistenceRef\.current\?\.retry\(\)/);
});
