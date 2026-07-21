import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("Living Margin exposes the settled four-lens vocabulary and truthful scope", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  assert.match(margin, /label: "Overview"/);
  assert.match(margin, /label: "Related", accessibleLabel: "Related verses"/);
  assert.match(margin, /label: "Words", accessibleLabel: "Words & structure"/);
  assert.match(margin, /label: "My notes", accessibleLabel: "My notes"/);
  assert.match(margin, /Following your reading ·/);
  assert.match(margin, /Selection ·/);
  assert.match(margin, />\s*Clear\s*</);
  assert.doesNotMatch(margin, /studyLockVerseRef/);
  assert.doesNotMatch(margin, /className="margin-hl-palette"/);
});

test("canvas and Study retain separate keyboard domains", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const app = read("src/renderer/app.tsx");
  assert.match(margin, /target\?\.closest\("\.verse-line"\)/);
  assert.doesNotMatch(margin, /closest\("\.verse-line, \.margin-tab"\)/);
  assert.match(margin, /event\.key === "Enter" \|\| event\.key === "ArrowDown"/);
  assert.match(margin, /target\?\.closest\("\.margin-tab-panel, \.margin-frame-header"\)/);
  assert.match(app, /event\.key !== "F6"/);
  assert.match(app, /event\.shiftKey \? -1 : 1/);
  assert.match(app, /setShortcutsOpen\(true\)/);
  assert.match(app, /<ShortcutsOverlay onClose=/);
});

test("accessible reading and related-verse names include visible content", () => {
  const page = read("src/renderer/components/ScripturePage.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");
  assert.match(page, /aria-label=\{`\$\{displayBookName\} \$\{chapter\}:\$\{v\.verse\}\. \$\{v\.text\}/);
  assert.match(page, /\$\{isSelected \? "\. Selected" : ""\}/);
  assert.match(margin, /item\.preview \? `Open \$\{item\.targetDisplay\}\. \$\{item\.preview\}`/);
  assert.match(appSource(), /target\?\.isConnected/);
  assert.match(appSource(), /#living-margin-title/);
});

test("multi-verse Words chooses an explicit verse without changing canvas selection", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  assert.match(margin, /role="radiogroup" aria-label="Words for verse"/);
  assert.match(margin, /verse=\{wordsVerse\}/);
  assert.match(margin, /onClick=\{\(\) => setWordsVerse\(verse\)\}/);
});

function appSource(): string {
  return read("src/renderer/app.tsx");
}
