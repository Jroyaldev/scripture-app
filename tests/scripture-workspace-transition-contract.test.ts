import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const page = readFileSync(resolve(import.meta.dirname, "../src/renderer/components/ScripturePage.tsx"), "utf8");
const app = readFileSync(resolve(import.meta.dirname, "../src/renderer/app.tsx"), "utf8");
const lifecycle = readFileSync(resolve(import.meta.dirname, "../src/renderer/utils/connectionDraftLifecycle.ts"), "utf8");

test("ScripturePage exposes one owner-correlated live canvas capture controller", () => {
  const capture = page.slice(
    page.indexOf("captureCurrentStudyCanvasRef.current = () =>"),
    page.indexOf("const handleLivingMarginScrollControllerChange"),
  );
  assert.match(page, /export interface StudyCanvasCapture \{\s*ownerTabId: string;\s*entry: PassageViewState;\s*\}/);
  assert.match(page, /export interface StudyCanvasController \{\s*flushPendingMarginScroll\(\): void;\s*captureCurrent\(\): StudyCanvasCapture \| null;/);
  assert.match(page, /sessionOwnerTabId: string;/);
  assert.match(capture, /if \(!chapterData \|\| loadedChapterKeyRef\.current !== chapterKey\) return null;/);
  assert.match(
    capture,
    /if \(chapterError && failedChapterKeyRef\.current === chapterKey\) \{\s*return \{ ownerTabId: sessionOwnerTabId, entry: sessionEntryRef\.current \};\s*\}/,
  );
  assert.ok(
    capture.indexOf("restoredSessionOwnerTabId !== sessionOwnerTabId") < capture.indexOf("if (chapterError &&"),
    "an unavailable canvas can reuse only the already-restored owner-correlated session",
  );
  assert.match(page, /return \{ ownerTabId: sessionOwnerTabId, entry: captureNavigationEntry\(\) \};/);
  assert.match(page, /restoredSessionOwnerTabId !== sessionOwnerTabId/);
  assert.match(page, /onStudyCanvasControllerChange\?\.\(studyCanvasController\)[\s\S]*onStudyCanvasControllerChange\?\.\(null\)/);
  assert.match(page, /livingMarginScrollControllerRef\.current\?\.flushPendingScroll\(\)/);
  assert.match(
    page,
    /data-study-canvas-owner=\{restoredSessionOwnerTabId === sessionOwnerTabId \? sessionOwnerTabId : undefined\}/,
  );
});

test("App rejects stale canvas captures and updates the owner synchronously", () => {
  const capture = app.slice(
    app.indexOf("const captureCurrentStudyWorkspace"),
    app.indexOf("const runWorkspaceTransition"),
  );
  const flushPendingMargin = capture.indexOf("controller.flushPendingMarginScroll()");
  const readFlushedWorkspace = capture.indexOf("const current = studyWorkspaceRef.current", flushPendingMargin);
  const captureCanvas = capture.indexOf("controller.captureCurrent()", readFlushedWorkspace);
  assert.ok(flushPendingMargin >= 0);
  assert.ok(
    readFlushedWorkspace > flushPendingMargin && captureCanvas > readFlushedWorkspace,
    "App must synchronously flush the margin before reading and capturing the structural-transition snapshot",
  );
  assert.match(capture, /captured\.ownerTabId !== canvasOwnerTabIdRef\.current/);
  assert.match(capture, /captured\.ownerTabId !== ownerId/);
  assert.match(capture, /updateActiveStudyCanvasSession\(current, captured\.ownerTabId/);
  assert.match(capture, /current: captured\.entry/);

  const commit = app.slice(
    app.indexOf("const commitStudyWorkspace"),
    app.indexOf("const loadData"),
  );
  assert.match(commit, /canvasOwnerTabIdRef\.current = next\?\.activeTabId \?\? null;[\s\S]{0,100}studyWorkspaceRef\.current = next;/);

  const hydration = app.slice(
    app.indexOf("safeCall(() => window.api.settings.get())"),
    app.indexOf("settingsLoaded.current = true"),
  );
  assert.match(hydration, /canvasOwnerTabIdRef\.current = resolvedWorkspace\.activeTabId/);
  assert.match(app, /sessionOwnerTabId=\{activeWorkspaceTab\.id\}/);
});

test("ScripturePage preflights mutations then asks authored owners in fixed order", () => {
  const preflight = page.indexOf("if (!requireSafeConnectionNavigation()) return false;");
  const owners = page.indexOf("[noteExitControllerRef.current, markingExitControllerRef.current, cardExitControllerRef.current]");
  assert.ok(preflight >= 0 && owners > preflight);
  assert.match(page, /onWorkspaceExitControllerChange\?\.\(workspaceExitController\)[\s\S]*onWorkspaceExitControllerChange\?\.\(null\)/);
  assert.match(page, /onDraftExitControllerChange=\{handleConnectionDraftExitControllerChange\}/);
  assert.match(page, /onExitControllerChange=\{handleCardExitControllerChange\}/);
  assert.match(page, /onExitControllerChange=\{handleNoteExitControllerChange\}/);
});

test("canvas navigation delegates one structural commit to App", () => {
  assert.doesNotMatch(page, /continueAfterDraftExit/);
  const transition = page.slice(
    page.indexOf("const requestWorkspaceTransition"),
    page.indexOf("// Verse nearest the reading eye-line"),
  );
  assert.match(page, /onRequestWorkspaceTransition: \(/);
  assert.doesNotMatch(page, /onRequestWorkspaceTransition\?: \(/);
  assert.match(transition, /return await onRequestWorkspaceTransition\(reason, commit\);/);
  assert.doesNotMatch(transition, /workspaceExitController\.requestExit/);
  assert.match(page, /const approved = await requestWorkspaceTransition\(\s*changesTranslation \? "translation-change" : "chapter-change",\s*performNavigation[\s\S]{0,80}return approved && navigationCommitted;/,
    "App owns the one transition commit and Scripture reports success only when that owner-correlated commit ran");
  assert.match(page, /historyMode: "traverse",\s*history: move\.history/);
  const pickerActivation = page.slice(
    page.indexOf("const activatePassagePickerTarget"),
    page.indexOf("useEffect(() => {", page.indexOf("const activatePassagePickerTarget")),
  );
  assert.match(pickerActivation, /goTo\(target\.book, target\.chapter, target\.verse, \{\s*packageId: target\.packageId,[\s\S]*if \(proceed\) closePassagePopover\(\)/,
    "an ordinary picker choice still delegates its one in-canvas transition through goTo");
  assert.match(pickerActivation, /openPassageTab\(target, "passage-picker"\)[\s\S]*if \(opened\) closePassagePopover\(\)/,
    "modifier and middle-click picker choices delegate their one new-tab commit to App");
  assert.match(page, /activatePassagePickerTarget\(\{[\s\S]{0,220}book: r\.book,[\s\S]{0,120}chapter: r\.chapter/);
});

test("same-coordinate navigation refuses unsafe local requests but accepts App-preapproved requests", () => {
  const goTo = page.slice(
    page.indexOf("const goTo = useCallback"),
    page.indexOf("const navigateBack"),
  );
  assert.match(goTo, /if \(!changesTranslation && !changesChapter && !opts\?\.preapproved && !requireSafeConnectionNavigation\(\)\) return false;/);
  assert.ok(
    goTo.indexOf("requireSafeConnectionNavigation()") < goTo.lastIndexOf("performNavigation();"),
    "same-coordinate mutation preflight must happen before navigation commits",
  );
});

test("research attention waits for tab approval before chooser and focus mutations", () => {
  const handler = page.slice(
    page.indexOf("const handleSelectConnection"),
    page.indexOf("const handleSelectAuthoredConnection"),
  );
  const approval = handler.indexOf("await requestScriptureWorkspaceAttention()");
  const held = handler.indexOf("replaceHeldConnectionIds");
  assert.ok(approval >= 0 && held > approval);
  assert.doesNotMatch(handler, /onCloseEntity\?\./);
  /* `onToggleGroup={(groupId, collapsing) => …}` was here: the collapse
     gesture threaded from the page into the strip, and this file's interest in
     it was that it went through the same approval as every other structural
     change. The gesture is retired on 2026-07-30 with the collapsed proxy —
     the strip holds one study's tabs, so folding one has nothing to hide — and
     the wiring is asserted on what the page still threads. */
  assert.doesNotMatch(page, /onToggleGroup/);
  assert.match(page, /onWorkspaceGroupRename\?\.\(groupId, label\)/);
});

test("marking draft reasons cover every structural workspace exit", () => {
  assert.match(lifecycle, /WorkspaceTransitionReason \| "escape"/);
  assert.match(lifecycle, /reason === "tab-change"/);
  assert.match(lifecycle, /reason === "tab-close"/);
  assert.match(lifecycle, /reason === "group-change"/);
});
