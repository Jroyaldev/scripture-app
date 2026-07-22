import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(join(root, "src/renderer/components/ScripturePage.tsx"), "utf8");
const peek = readFileSync(join(root, "src/renderer/components/VersePeek.tsx"), "utf8");
const margin = readFileSync(join(root, "src/renderer/components/LivingMargin.tsx"), "utf8");
const app = readFileSync(join(root, "src/renderer/app.tsx"), "utf8");
const main = readFileSync(join(root, "src/electron/main.ts"), "utf8");
const api = readFileSync(join(root, "src/renderer/api.ts"), "utf8");

test("goTo is the single deliberate canvas-history push point", () => {
  const start = page.indexOf("const goTo = useCallback(");
  const end = page.indexOf("const navigateBack = useCallback", start);
  assert.ok(start >= 0 && end > start);
  const goTo = page.slice(start, end);
  assert.match(goTo, /pushNavigationHistory\([\s\S]*captureNavigationEntry\(\)/);
  assert.match(goTo, /if \(opts\?\.historyMode === "traverse"\)[\s\S]*else \{[\s\S]*pushNavigationHistory/);
  assert.match(page, /activatePassagePickerTarget\(\{[\s\S]{0,220}?book: r\.book,[\s\S]{0,120}?chapter: r\.chapter/);
  assert.match(page, /activatePassagePickerTarget\(\{ book: browseBook, chapter: n \}/);
  assert.match(page, /goTo\(book, chapter - 1, undefined, \{ recordRecent: false \}\)/);
  assert.match(page, /handleNavigateToRef[\s\S]{0,900}?goTo\(/);
});

test("ordinary canvas travel stays inside the active passage or entity tab", () => {
  const goToStart = page.indexOf("const goTo = useCallback(");
  const goToEnd = page.indexOf("const navigateBack = useCallback", goToStart);
  const goTo = page.slice(goToStart, goToEnd);
  const studySelection = page.slice(
    page.indexOf("const selectStudyScope = useCallback"),
    page.indexOf("const handleVerseClick", page.indexOf("const selectStudyScope = useCallback")),
  );

  assert.ok(goToStart >= 0 && goToEnd > goToStart);
  assert.doesNotMatch(page, /requestCanvasResearchExit/);
  assert.doesNotMatch(goTo, /onCloseEntity|onWorkspaceTabClose/);
  assert.doesNotMatch(studySelection, /onCloseEntity|onWorkspaceTabClose/);
  assert.match(page, /handleNavigateToRef[\s\S]{0,900}?goTo\(/);
  assert.match(page, /const navigateBack[\s\S]{0,420}?goTo\(/);
  assert.match(page, /const navigateForward[\s\S]{0,420}?goTo\(/);
});

test("queued passage navigation is consumed only by its owning canvas", () => {
  assert.match(page, /navigateRef: \{ ownerTabId: string; book: string; chapter: number;/);
  const effectStart = page.indexOf("useEffect(() => {\n    if (!navigateRef) return;", page.indexOf("const navigateForward"));
  const effectEnd = page.indexOf("const publishSessionEntry", effectStart);
  const effect = page.slice(effectStart, effectEnd);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  assert.match(effect, /if \(navigateRef\.ownerTabId !== sessionOwnerTabId\) \{\s*onNavigateRefConsumed\?\.\(\);\s*return;/);
  assert.match(effect, /\}, \[navigateRef, sessionOwnerTabId\]\)/);
});

test("modifier and middle clicks are explicit passage-tab branches", async () => {
  const { passageTabOpenIntent } = await import("../src/renderer/utils/passageTabIntent.js");
  assert.equal(passageTabOpenIntent({ button: 0, metaKey: false, ctrlKey: false }), false);
  assert.equal(passageTabOpenIntent({ button: 0, metaKey: true, ctrlKey: false }), true);
  assert.equal(passageTabOpenIntent({ button: 0, metaKey: false, ctrlKey: true }), true);
  assert.equal(passageTabOpenIntent({ button: 1, metaKey: false, ctrlKey: false }), true);

  assert.match(page, /onOpenPassageTab\?: \(target: \{/);
  assert.match(page, /source\?: "chapter-step" \| "passage-picker" \| "verse-peek"/);
  assert.match(page, /const openPassageTab = useCallback/);
  assert.match(page, /onAuxClick=\{handlePreviousChapterAuxClick\}/);
  assert.match(page, /onAuxClick=\{handleNextChapterAuxClick\}/);
  assert.match(page, /onClick=\{handlePreviousChapterClick\}/);
  assert.match(page, /onClick=\{handleNextChapterClick\}/);
  const previousHandler = page.slice(
    page.indexOf("const handlePreviousChapterClick"),
    page.indexOf("const handleNextChapterClick"),
  );
  const branch = page.slice(
    page.indexOf("const openChapterStepInTab"),
    page.indexOf("const handlePreviousChapterClick"),
  );
  assert.match(previousHandler, /passageTabOpenIntent\(event\)/);
  assert.match(previousHandler, /openChapterStepInTab\(chapter - 1\)/);
  assert.match(branch, /openPassageTab\([\s\S]{0,100}?"chapter-step"/);
});

test("VersePeek keeps Study and new passage tabs as separate actions", () => {
  assert.match(peek, /onKeepReference\?: \(target: PeekTarget\) => void/);
  assert.match(peek, /onOpenPassageTab\?: \([\s\S]{0,120}?options\?: VersePeekOpenOptions/);
  assert.match(peek, />\s*Keep in Study\s*</);
  assert.match(peek, /"Open passage tab"/);
  assert.match(peek, /if \(await onOpenPassageTab\(peek\.target, \{ focusDestination \}\)\) onClose\(\)/);
  const keepAction = peek.slice(
    peek.indexOf('className="verse-peek-keep"'),
    peek.indexOf("</button>", peek.indexOf('className="verse-peek-keep"')),
  );
  assert.doesNotMatch(keepAction, /onOpenPassageTab/);
});

test("Return focuses the committed passage tab after Research unmounts", () => {
  const start = app.indexOf("const returnEntityOrigin = useCallback");
  const end = app.indexOf("const selectWorkspaceTab", start);
  assert.ok(start >= 0 && end > start);
  const returnOrigin = app.slice(start, end);
  assert.match(returnOrigin, /returnedTabId = accepted \? result\.state\.activeTabId : null/);
  assert.match(returnOrigin, /proceed && accepted && returnedTabId/);
  assert.match(returnOrigin, /focusWorkspaceTabAfterCommit\(returnedTabId\)/);
});

test("topbar and Alt arrows expose the same browser-style Back and Forward", () => {
  assert.ok(page.indexOf('className="canvas-history-arrows"') < page.indexOf('className="passage-picker-group"'));
  assert.match(page, /onClick=\{navigateBack\}[\s\S]{0,220}?aria-label="Back"[\s\S]{0,100}?aria-keyshortcuts="Alt\+ArrowLeft"/);
  assert.match(page, /onClick=\{navigateForward\}[\s\S]{0,220}?aria-label="Forward"[\s\S]{0,100}?aria-keyshortcuts="Alt\+ArrowRight"/);
  const shortcut = page.slice(page.indexOf("const handleHistoryShortcut"), page.indexOf("// Keyboard navigation: prev/next chapter"));
  assert.match(shortcut, /target\?\.matches\("input, textarea, select"\) \|\| target\?\.isContentEditable/);
  assert.match(shortcut, /\[data-floating-layer="dialog"\]/);
  assert.match(shortcut, /navigateBack\(\)/);
  assert.match(shortcut, /navigateForward\(\)/);
});

test("lastRead uses the shared verse and pixel eye-line contract", () => {
  for (const schema of [main, api]) {
    const start = schema.indexOf("lastRead: {");
    assert.ok(start >= 0);
    assert.match(schema.slice(start, start + 420), /verse\?: number/);
    assert.match(schema.slice(start, start + 420), /verseOffset\?: number/);
  }
  assert.match(page, /const captureReadingViewport = useCallback/);
  assert.match(page, /captureTranslationViewport[\s\S]{0,220}?captureReadingViewport\(\)/);
  assert.match(page, /restoreReadingViewport\(target\)/);
  assert.match(page, /currentOffset - viewport\.verseOffset/);
  assert.match(page, /persistCurrentReadingPositionRef\.current\(\)/);
});

test("active V2 tabs retain history while research separates Back, Return, and Close", () => {
  assert.match(app, /activeStudyWorkspaceSession\(studyWorkspace\)/);
  assert.match(app, /navigationHistory=\{activeWorkspaceSession\.history\}/);
  assert.match(app, /sessionEntry=\{activeWorkspaceSession\.current\}/);
  assert.match(app, /updateActiveStudyCanvasSession/);
  assert.match(page, /onNavigateRefConsumed\?\.\(\)/);
  assert.match(margin, /const previousEntity = entityTrail\.at\(currentResearchIsRecorded \? -2 : -1\)/);
  assert.match(margin, /previousEntity && onDrillEntity/);
  assert.match(margin, /aria-label=\{`Back to \$\{previousEntity\.displayName\}`\}/);
  assert.match(margin, /className="entity-research-return"[\s\S]{0,180}?onClick=\{onReturnEntityOrigin\}/);
  assert.match(margin, /className="entity-research-close"[\s\S]{0,180}?onClick=\{onCloseEntity\}/);
  assert.doesNotMatch(margin, /entity-research-back[\s\S]{0,180}?navigateBack/);
});
