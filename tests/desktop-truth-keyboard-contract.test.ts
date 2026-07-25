import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("Living Margin exposes the settled four-lens vocabulary and truthful scope", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  // Four lenses, in this order, each a single ordinary word. "Related" and
  // "My notes" were the visible labels of an earlier vocabulary; the lens rail
  // now reads Overview / Notes / Connections / Words, and the longer phrases
  // survive only where a screen reader needs the disambiguation.
  assert.match(margin, /type MarginTab = "overview" \| "connections" \| "passage" \| "notes"/);
  assert.match(
    margin,
    /const MARGIN_TABS[^=]*=\s*\[\s*\{ id: "overview", label: "Overview", accessibleLabel: "Overview" \},\s*\{ id: "notes", label: "Notes", accessibleLabel: "My notes" \},\s*\{ id: "connections", label: "Connections", accessibleLabel: "Connections" \},\s*\{ id: "passage", label: "Words", accessibleLabel: "Words & structure" \},\s*\]/,
  );
  // No fifth lens, and no label that is a phrase where the others are words.
  const tabTable = margin.slice(margin.indexOf("const MARGIN_TABS"), margin.indexOf("];", margin.indexOf("const MARGIN_TABS")));
  assert.equal([...tabTable.matchAll(/\bid: "/g)].length, 4, "the margin carries exactly four lenses");
  for (const label of [...tabTable.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]!)) {
    assert.doesNotMatch(label, /\s/, `lens label "${label}" must be one word`);
  }
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
  assert.match(margin, /onMarginSessionChange\(sessionOwnerTabId, \(current\) => \(\{ \.\.\.current, \.\.\.update \}\)\)/);
  assert.match(margin, /onClick=\{\(\) => setWordsState\(\{ wordsVerse: verse, wordsFollowingReading: false \}\)\}/);
});

function appSource(): string {
  return read("src/renderer/app.tsx");
}
