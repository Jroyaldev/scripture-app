import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const page = readFileSync(resolve(import.meta.dirname, "../src/renderer/components/ScripturePage.tsx"), "utf8");
const app = readFileSync(resolve(import.meta.dirname, "../src/renderer/app.tsx"), "utf8");
const lifecycle = readFileSync(resolve(import.meta.dirname, "../src/renderer/utils/connectionDraftLifecycle.ts"), "utf8");

test("ScripturePage exposes one owner-correlated live canvas capture controller", () => {
  assert.match(page, /export interface StudyCanvasCapture \{\s*ownerTabId: string;\s*entry: PassageViewState;\s*\}/);
  assert.match(page, /export interface StudyCanvasController \{\s*flushPendingMarginScroll\(\): void;\s*captureCurrent\(\): StudyCanvasCapture \| null;/);
  assert.match(page, /sessionOwnerTabId: string;/);
  assert.match(page, /loadedChapterKeyRef\.current !== `\$\{sessionOwnerTabId\}:\$\{packageId\}:\$\{book\}:\$\{chapter\}`\) return null;/);
  assert.match(page, /return \{ ownerTabId: sessionOwnerTabId, entry: captureNavigationEntry\(\) \};/);
  assert.match(page, /restoredSessionOwnerTabId !== sessionOwnerTabId/);
  assert.match(page, /onStudyCanvasControllerChange\?\.\(studyCanvasController\)[\s\S]*onStudyCanvasControllerChange\?\.\(null\)/);
  assert.match(page, /livingMarginScrollControllerRef\.current\?\.flushPendingScroll\(\)/);
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
  assert.match(page, /goTo\(r\.book, r\.chapter, r\.verse, \{\s*packageId: r\.packageId,[\s\S]*if \(proceed\) closePassagePopover\(\)/);
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
  assert.match(page, /onToggleGroup=\{\(groupId, collapsing\) =>/);
});

test("marking draft reasons cover every structural workspace exit", () => {
  assert.match(lifecycle, /WorkspaceTransitionReason \| "escape"/);
  assert.match(lifecycle, /reason === "tab-change"/);
  assert.match(lifecycle, /reason === "tab-close"/);
  assert.match(lifecycle, /reason === "group-change"/);
});
