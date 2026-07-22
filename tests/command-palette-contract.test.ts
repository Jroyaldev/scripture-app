import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

type ApprovalGate = (
  inFlight: { current: boolean },
  request: () => Promise<boolean>,
  commit: () => void,
  ownerIsCurrent?: () => boolean,
) => Promise<boolean>;

async function loadApprovalGate(): Promise<ApprovalGate> {
  const paletteModule = await import("../src/renderer/components/CommandPalette.js") as Record<string, unknown>;
  const gate = paletteModule.runApprovedPaletteActivation;
  assert.equal(typeof gate, "function", "CommandPalette must expose its real approval gate for focused behavior tests");
  return gate as ApprovalGate;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

test("command palette has four truthful high-traffic lenses", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  for (const label of ["Intelligence", "Scripture", "My notes", "Names"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
});

test("command palette traps focus, restores it, and exposes complete keyboard traversal", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  assert.match(source, /const isLensKey = event\.key === "Tab" \|\| event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(source, /const reverse = event\.key === "ArrowLeft" \|\| \(event\.key === "Tab" && event\.shiftKey\)/);
  assert.match(source, /% visibleTabs\.length/);
  assert.match(source, /setActiveTab\(\(current\) =>/);
  assert.match(source, /inputRef\.current\?\.focus\(\)/);
  assert.match(source, /returnFocusRef/);
  assert.match(source, /returnFocusRef\.current = null/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("palette keeps public Scripture, local notes, and TIPNR names as separate indexes", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  assert.match(source, /window\.api\.scripture\.search/);
  assert.match(source, /window\.api\.library\.search/);
  assert.match(source, /window\.api\.language\.searchEntities/);
  assert.match(source, /My notes/);
  assert.match(source, /Name matches rank before definition matches/);
});

test("name results open reversible Living Margin research instead of guessing a verse", () => {
  const command = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf8");
  assert.match(command, /onOpenEntity: \(target: CommandEntityTarget\) => Promise<boolean>/);
  assert.match(command, /activate: \(\) => activateResult\(\(\) => onOpenEntity\(\{/);
  assert.doesNotMatch(command, /closeAnd\(\(\) => onOpenEntity/);
  assert.match(app, /const openCommandEntityResearch = useCallback\(\(target: CommandEntityTarget\): Promise<boolean> =>/);
  assert.doesNotMatch(command, /bestEntityRef|parseEntityRef/);
  assert.match(app, /openEntityWorkspaceTab\(workspace, \{/);
  assert.match(app, /navigateEntityWorkspaceTab\(navigableWorkspace, activeTab\.id, trailTarget, nonce\)/);
  assert.match(app, /setMarginVisible\(true\)/);
  assert.match(margin, /window\.api\.language\.getEntityResearch\(entityIntent\.id\)/);
  assert.match(margin, /data-margin-mode="research"/);
  assert.match(margin, /window\.addEventListener\("keydown", closeResearch, true\)/);
  assert.match(margin, /onCloseEntity/);
});

test("every palette destination shares one approval-first single-flight boundary", () => {
  const command = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");

  assert.match(command, /onNavigate: \(book: string, chapter: number, verse\?: number, endVerse\?: number\) => Promise<boolean>/);
  assert.match(command, /onOpenNote: \(noteId: string\) => Promise<boolean>/);
  assert.match(command, /onOpenEntity: \(target: CommandEntityTarget\) => Promise<boolean>/);
  assert.match(command, /onOpenPassage: \(book: string, chapter: number/);
  assert.match(command, /onDuplicatePassage: \(\) => Promise<boolean>/);
  assert.match(command, /onStartStudy: \(\) => Promise<boolean>/);
  assert.match(command, /onSearchNotes: \(query: string\) => Promise<boolean>/);
  assert.match(command, /onRunAction: \(id: string\) => Promise<boolean>/);
  assert.match(command, /const resultActivationInFlightRef = useRef\(false\)/);
  assert.match(command, /const activateResult = useCallback\(\(request: \(\) => Promise<boolean>\): void =>/);
  assert.equal(
    [...command.matchAll(/activate: \(\) => activateResult\(/g)].length,
    7,
    "exact, Scripture, note, entity, action, recent, and deep-search destinations must use the same gate",
  );
  assert.doesNotMatch(command, /closeAnd/);
  assert.match(app, /const runCommandAction = \(id: string\): Promise<boolean> =>/);
  assert.match(app, /onOpenNote=\{\(noteId\) => changeView\("notes"/);
  assert.match(app, /onSearchNotes=\{\(query\) => changeView\("search"/);

  const changeView = app.slice(
    app.indexOf("const changeView"),
    app.indexOf("window.api.appWindow.onCloseRequested"),
  );
  assert.match(changeView, /if \(viewRef\.current === next && !onProceed\) return true;/);
  assert.doesNotMatch(changeView, /if \(viewRef\.current === next\) \{\s*onProceed\?\.\(\)/);
});

test("palette Scripture navigation has one App approval and no later canvas veto", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf8");
  const handler = app.slice(
    app.indexOf("const handleNavigateToRef"),
    app.indexOf("const consumeNavigateRef"),
  );
  assert.match(handler, /\): Promise<boolean> => \{/);
  assert.match(handler, /return runWorkspaceTransition\(/);
  assert.match(handler, /setNavigateRef\(\{ ownerTabId, book, chapter, verse, endVerse, preapproved: true \}\)/);
  assert.doesNotMatch(handler, /void changeView/);

  assert.match(page, /navigateRef: \{ ownerTabId: string; book: string; chapter: number; verse\?: number; endVerse\?: number; preapproved: true \} \| null/);
  const externalNavigation = page.slice(
    page.indexOf("if (!navigateRef) return;"),
    page.indexOf("const publishSessionEntry"),
  );
  assert.match(externalNavigation, /preapproved: navigateRef\.preapproved/);
  assert.match(externalNavigation, /if \(proceed\) onNavigateRefConsumed\?\.\(\)/);

  const goTo = page.slice(
    page.indexOf("const goTo = useCallback"),
    page.indexOf("const navigateBack"),
  );
  assert.match(goTo, /if \(opts\?\.preapproved\) \{\s*performNavigation\(\);\s*return navigationCommitted;\s*\}/);
  assert.match(goTo, /if \(sessionOwnerTabIdRef\.current !== requestedOwnerTabId\) return;/,
    "a preapproved request still fails closed if its original canvas owner is stale");
  assert.match(goTo, /!opts\?\.preapproved && !requireSafeConnectionNavigation\(\)/);
});

test("approved palette Scripture navigation preserves the active canvas owner and every open tab", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const handler = app.slice(
    app.indexOf("const handleNavigateToRef"),
    app.indexOf("const consumeNavigateRef"),
  );
  assert.equal(
    [...handler.matchAll(/runWorkspaceTransition\(/g)].length,
    1,
    "Scripture selection must have exactly one App approval gate",
  );
  assert.match(
    handler,
    /const ownerTabId = studyWorkspaceRef\.current\?\.activeTabId[\s\S]*runWorkspaceTransition\(reason, \(\) => \{[\s\S]*setNavigateRef\(\{ ownerTabId, book, chapter, verse, endVerse, preapproved: true \}\)/,
  );
  assert.doesNotMatch(handler, /activateStudyCanvasOwnerPassageTab|closeStudyWorkspaceTab|commitStudyWorkspace/);
});

test("a refused or rejected destination leaves palette-owned state untouched", async () => {
  const runApprovedActivation = await loadApprovalGate();
  const inFlight = { current: false };
  const palette = {
    open: true,
    query: "paul",
    resultIds: ["entity:Paul", "entity:Paulus"],
    focusedResult: 0,
    focusOwner: "entity:Paul",
  };
  const original = structuredClone(palette);
  const commit = (): void => {
    palette.open = false;
    palette.query = "";
    palette.resultIds = [];
    palette.focusedResult = -1;
    palette.focusOwner = "invoker";
  };

  assert.equal(await runApprovedActivation(inFlight, async () => false, commit), false);
  assert.deepEqual(palette, original);
  assert.equal(inFlight.current, false);

  assert.equal(await runApprovedActivation(inFlight, async () => { throw new Error("veto"); }, commit), false);
  assert.deepEqual(palette, original);
  assert.equal(inFlight.current, false);
});

test("a destination closes only after explicit approval", async () => {
  const runApprovedActivation = await loadApprovalGate();
  const decision = deferred<boolean>();
  const inFlight = { current: false };
  let closes = 0;
  const activation = runApprovedActivation(inFlight, () => decision.promise, () => { closes += 1; });

  await Promise.resolve();
  assert.equal(closes, 0);
  assert.equal(inFlight.current, true);

  decision.resolve(true);
  assert.equal(await activation, true);
  assert.equal(closes, 1);
  assert.equal(inFlight.current, false);
});

test("destination activation is single-flight and becomes retryable after settlement", async () => {
  const runApprovedActivation = await loadApprovalGate();
  const firstDecision = deferred<boolean>();
  const inFlight = { current: false };
  let requests = 0;
  let commits = 0;
  const request = (): Promise<boolean> => {
    requests += 1;
    return firstDecision.promise;
  };

  const first = runApprovedActivation(inFlight, request, () => { commits += 1; });
  const duplicate = runApprovedActivation(inFlight, request, () => { commits += 1; });
  assert.equal(await duplicate, false);
  assert.equal(requests, 1);
  assert.equal(commits, 0);

  firstDecision.resolve(false);
  assert.equal(await first, false);
  assert.equal(inFlight.current, false);

  assert.equal(await runApprovedActivation(inFlight, async () => {
    requests += 1;
    return true;
  }, () => { commits += 1; }), true);
  assert.equal(requests, 2);
  assert.equal(commits, 1);
});

test("an approval from a dismissed palette cannot close or move focus in a later palette", async () => {
  const runApprovedActivation = await loadApprovalGate();
  const decision = deferred<boolean>();
  const inFlight = { current: false };
  const owner = { current: 1 };
  let closes = 0;
  const activation = runApprovedActivation(
    inFlight,
    () => decision.promise,
    () => { closes += 1; },
    () => owner.current === 1,
  );

  owner.current = 2;
  decision.resolve(true);

  assert.equal(await activation, false);
  assert.equal(closes, 0);
  assert.equal(inFlight.current, false);

  const command = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  assert.match(command, /const paletteOwnerRef = useRef\(0\)/);
  assert.match(command, /useLayoutEffect\(\(\) => \{[\s\S]{0,220}paletteOwnerRef\.current/);
  assert.match(command, /const dismissPalette = useCallback[\s\S]{0,180}paletteOwnerRef\.current \+= 1[\s\S]{0,120}onClose\(\)/);
  assert.match(command, /const owner = paletteOwnerRef\.current[\s\S]{0,220}\(\) => openRef\.current && paletteOwnerRef\.current === owner/);
  assert.match(command, /className="command-palette-scrim"[\s\S]{0,100}onClick=\{dismissPalette\}/);
  assert.match(command, /const restoreOwner = paletteOwnerRef\.current[\s\S]{0,220}if \(openRef\.current \|\| paletteOwnerRef\.current !== restoreOwner\) return/);
});

test("entity research preserves its exact opening passage and labels evidence truthfully", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf8");

  assert.match(app, /setCommandContext\(readingContext\)/);
  assert.match(app, /context=\{commandContext\}/);
  assert.match(app, /onOpenEntity=\{openCommandEntityResearch\}/);
  assert.match(page, /chapterEndVerse: backbone\.books\[book\]\?\.chapters\[chapter - 1\]/);
  assert.match(margin, /deriveEntityOpeningContext\(data\.entity\.refs, openingOrigin\)/);
  assert.match(margin, /From your reading/);
  assert.match(margin, /Broader research/);
  assert.match(margin, /No TIPNR-indexed mention in \{scopeLabel\}/);
});
