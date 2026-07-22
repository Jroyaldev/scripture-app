import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(join(root, "src/renderer/components/ScripturePage.tsx"), "utf8");
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
  assert.match(page, /goTo\(r\.book, r\.chapter, r\.verse, \{\s*packageId: r\.packageId/);
  assert.match(page, /goTo\(browseBook, n\)/);
  assert.match(page, /goTo\(book, chapter - 1, undefined, \{ recordRecent: false \}\)/);
  assert.match(page, /handleNavigateToRef[\s\S]{0,900}?goTo\(/);
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

test("renderer session retains history and research Back names its destination", () => {
  assert.match(app, /useState<NavigationHistoryState>[\s\S]{0,100}?createNavigationHistory/);
  assert.match(app, /const \[canvasSessionEntry, setCanvasSessionEntry\]/);
  assert.match(page, /onNavigateRefConsumed\?\.\(\)/);
  assert.match(margin, /const researchBackDestination = entityTrail\.at\(currentResearchIsRecorded \? -2 : -1\)\?\.displayName/);
  assert.match(margin, /aria-label=\{`Back to \$\{researchBackDestination\}`\}/);
  assert.doesNotMatch(margin, /entity-research-back[\s\S]{0,180}?navigateBack/);
});
