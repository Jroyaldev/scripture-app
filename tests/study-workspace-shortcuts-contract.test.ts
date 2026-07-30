import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const app = read("src/renderer/app.tsx");
const overlay = read("src/renderer/components/ShortcutsOverlay.tsx");

test("workspace shortcuts cycle visual tab order without colliding with the macOS app switcher", () => {
  assert.match(app, /event\.ctrlKey[\s\S]{0,220}event\.key === "Tab"/);
  /* Cycling walks the STRIP — the active study's tabs. This read
     `visibleStudyWorkspaceTabIds(current)`, the whole workspace with each
     collapsed study folded to one proxy, which was the same list while the
     strip held every study. The register holds one study at a time as of
     2026-07-30, and a cycle that leaves the row you are looking at is a jump
     rather than a cycle. Crossing studies is the study line's, the overview's
     and reopen's. */
  assert.match(app, /studyWorkspaceStripTabIds\(current\)/);
  assert.match(app, /event\.shiftKey \? -1 : 1/);
  assert.doesNotMatch(overlay, /⌘ Tab/);
  assert.match(overlay, /Ctrl Tab[\s\S]{0,100}next Study tab/);
  assert.match(overlay, /⇧ Ctrl Tab[\s\S]{0,100}previous Study tab/);
});

test("close and reopen use conventional accelerators through authored workspace transitions", () => {
  assert.match(app, /studyWorkspaceTabCloseAvailability\(current, current\.activeTabId\)/);
  assert.match(app, /void closeResearchTab\(current\.activeTabId\)/);
  assert.match(app, /void reopenRecentWorkspaceItem\(\)/);
  assert.match(overlay, /Ctrl W[\s\S]{0,30}⌘ W[\s\S]{0,100}Close the current Study tab/);
  assert.match(overlay, /⇧ Ctrl T[\s\S]{0,30}⇧ ⌘ T[\s\S]{0,120}Reopen the last closed Study tab or group/);
});

test("shortcut help makes current-tab chapter movement and explicit passage branching clear", () => {
  assert.match(overlay, /Move the current tab to the previous or next chapter/);
  assert.match(overlay, /Open a chapter, passage, or cross-reference in another tab/);
});
