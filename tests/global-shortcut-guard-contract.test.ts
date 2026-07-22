import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(repoRoot, "src/renderer/app.tsx"), "utf8");
const scripturePage = readFileSync(
  resolve(repoRoot, "src/renderer/components/ScripturePage.tsx"),
  "utf8",
);

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  assert.ok(end > start, `source markers are out of order: ${startMarker}`);
  return source.slice(start, end);
}

test("one App guard protects global shortcuts from active authored and floating work", () => {
  const guard = sourceBetween(
    app,
    "const globalShortcutBlocked",
    "const onKey = (event: KeyboardEvent)",
  );

  assert.match(guard, /event\.defaultPrevented/);
  assert.match(guard, /target\?\.matches\("input, textarea, select"\) \|\| target\?\.isContentEditable/);
  assert.match(guard, /authoredMutationStateRef\.current !== "idle"/);
  assert.match(guard, /!layerStackIsEmpty\(\)/);
  assert.match(
    guard,
    /document\.querySelector\('\[data-floating-layer="dialog"\], \[data-floating-layer="popover"\], \.command-palette-root'\)/,
    "the DOM fallback must close the render-to-layer-registration gap",
  );
});

test("workspace, command, help, pane-cycle, and view/focus shortcuts all consult the shared guard", () => {
  const guardCalls = app.match(/if \(globalShortcutBlocked\((?:event|e)\)\) return;/g) ?? [];
  assert.equal(guardCalls.length, 5);

  const workspace = sourceBetween(
    app,
    "const handleStudyWorkspaceShortcut",
    'window.addEventListener("keydown", handleStudyWorkspaceShortcut, true)',
  );
  assert.ok(workspace.indexOf("globalShortcutBlocked(event)") < workspace.indexOf("studyWorkspaceRef.current"));

  const command = sourceBetween(
    app,
    'event.key.toLocaleLowerCase() !== "k") return;',
    "}, [globalShortcutBlocked, openCommandPalette]",
  );
  assert.ok(command.indexOf("globalShortcutBlocked(event)") < command.indexOf("event.preventDefault()"));

  const help = sourceBetween(app, "const openShortcutsOverlay", "const cyclePanes");
  assert.ok(help.indexOf("globalShortcutBlocked(event)") < help.indexOf("setShortcutsOpen(true)"));

  const panes = sourceBetween(app, "const cyclePanes", "// Global keyboard:");
  assert.ok(panes.indexOf("globalShortcutBlocked(event)") < panes.indexOf("const panes:"));

  const viewAndFocus = sourceBetween(app, "// Global keyboard:", "const shellClass");
  assert.ok(viewAndFocus.indexOf("globalShortcutBlocked(e)") < viewAndFocus.indexOf('e.key === "f"'));
});

test("one Scripture guard protects history and chapter arrows from authored and floating work", () => {
  const guard = sourceBetween(
    scripturePage,
    "const canvasShortcutBlocked",
    "// Browser-style canvas history",
  );
  assert.match(guard, /event\.defaultPrevented/);
  assert.match(guard, /target\?\.matches\("input, textarea, select"\) \|\| target\?\.isContentEditable/);
  assert.match(guard, /!layerStackIsEmpty\(\)/);
  assert.match(
    guard,
    /document\.querySelector\('\[data-floating-layer="dialog"\], \[data-floating-layer="popover"\], \.command-palette-root'\)/,
  );
  assert.match(guard, /!requireSafeConnectionNavigation\(\)/);

  const history = sourceBetween(
    scripturePage,
    "const handleHistoryShortcut",
    "// Keyboard navigation: prev/next chapter",
  );
  assert.ok(history.indexOf("canvasShortcutBlocked(event)") < history.indexOf("event.preventDefault()"));
  assert.match(history, /event\.key === "ArrowLeft"[\s\S]*navigateBack\(\)/);
  assert.match(history, /navigateForward\(\)/);

  const chapters = sourceBetween(
    scripturePage,
    "// Keyboard navigation: prev/next chapter",
    "// The marking surfaces are sized",
  );
  assert.ok(chapters.indexOf("canvasShortcutBlocked(e)") < chapters.indexOf("e.preventDefault()"));
  assert.match(chapters, /const plainReadingArrow =/);
  assert.match(chapters, /const appArrow = e\.metaKey \|\| e\.ctrlKey/);
  assert.match(chapters, /goTo\(book, chapter - 1/);
  assert.match(chapters, /goTo\(book, chapter \+ 1/);
});
