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
  // This used to assert /item\.preview \? `Open \$\{item\.targetDisplay\}\. \$\{item\.preview\}`/
  // against the Connections tab's `.crossref-row`, which was one button whose
  // accessible name carried the verse preview. That row is deleted: the tab
  // shows connections now, and Overview re-drew the edition's list on C4·2's
  // compact row (Quire C·4). Two rows carry the requirement instead.
  //
  // Overview's row is a div, not a button, so the preview is visible sibling
  // content rather than part of a single control's name. The verb names its
  // target and is DESCRIBED by the wording, so a reader moving button-to-button
  // still hears the verse — without it being said twice to anyone reading the
  // row through, and without an unbounded fade-cut fragment inside a button's
  // name. (This line first asserted the bare `<p>`, before the description was
  // wired; the requirement is the tie, not the paragraph.)
  assert.match(margin, /aria-label=\{`Open \$\{item\.targetDisplay\}`\}/);
  assert.match(margin, /aria-describedby=\{previewId\}/);
  assert.match(margin, /<p className="study-ref-row-text" id=\{previewId\}>\{item\.preview\}<\/p>/);
  // Same tie on the reader's own notes, where the wording is the whole point.
  // Deliberately not pinned to adjacent lines: reordering JSX props changes no
  // behaviour, and a test that fails on a reformat teaches people to distrust it.
  assert.match(margin, /aria-label=\{`Go to \$\{entry\.reference\}`\}[\s\S]{0,160}?aria-describedby=\{noteId\}/);
  // Description ids are per-instance, so two margins cannot cross-wire one
  // row's verse onto another row's verb.
  assert.match(margin, /const rowIdBase = useId\(\);/);
  // A connection block IS one button, so its name must carry everything its
  // children would have said — the label overrides them. Three things follow,
  // and the last two were found by applying that rule back to this block:
  //   · the members' wording, which is the reason the row exists;
  //   · the arity in the row's own words, bound once so the visible text and
  //     the name cannot drift onto different nouns;
  //   · the member's role, which is otherwise carried by ink alone (Echo's
  //     source, a hinge's pivot against its span) and so is inaudible.
  assert.match(margin, /member\.quote\s*\n?\s*\? `\$\{role\}\$\{member\.position\}\. \$\{member\.quote\}`/);
  assert.match(margin, /const role = member\.role === "member" \? "" : `\$\{member\.role\}, `/);
  assert.match(margin, /const arity = `\$\{members\.length\} \$\{members\.length === 1 \? "member" : "members"\}`/);
  assert.match(margin, /aria-label=\{`\$\{kindLabel\}, \$\{arity\}: \$\{members\.map\(memberName\)\.join\(", "\)\}`\}/);
  assert.match(margin, /<span className="margin-connection-arity">\{arity\}<\/span>/);
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
