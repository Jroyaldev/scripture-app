import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");

test("reading canvas is a semantic chapter article without ambient AI tags", () => {
  assert.match(page, /<article className="scripture-inner" aria-labelledby="reading-chapter-title">/);
  assert.match(page, /<h1 id="reading-chapter-title" className="chapter-title"/);
  assert.doesNotMatch(page, /theme-tag-row/);
  assert.doesNotMatch(css, /\.theme-tag-row/);
  assert.match(css, /\.chapter-title\s*\{[\s\S]*font-size: clamp\(/);
});

test("reading canvas exposes deliberate loading, error, and empty states", () => {
  assert.match(page, /function ReadingCanvasLoading/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /function ReadingCanvasError/);
  assert.match(page, /<summary>Technical details<\/summary>/);
  assert.match(page, /function ReadingCanvasEmpty/);
  assert.match(page, /chapterData && chapterData\.verses\.length === 0/);
  assert.match(page, /if \(res\.ok && res\.value\)/);
  assert.match(
    page,
    /setChapterError\(\s*res\.ok\s*\? "This installed Bible text does not include the requested chapter\."\s*: res\.error,?\s*\)/,
    "a resolved null chapter must become a recoverable unavailable state instead of an endless skeleton",
  );
  assert.match(css, /\.reading-skeleton-line/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reading-skeleton-line/);
});

/** Every flat rule block in the sheet, as [selector, body] pairs. */
function ruleBlocks(): Array<[string, string]> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

test("verse rows use quiet material states and keyboard spatial navigation", () => {
  assert.match(page, /event\.key === "ArrowUp"/);
  assert.match(page, /event\.key === "ArrowDown"/);
  assert.match(page, /event\.key === "Home"/);
  assert.match(page, /event\.key === "End"/);
  assert.match(page, /verseRowRefs\.current\.get\(targetVerse\)\?\.focus\(\)/);

  // The row is two columns: a fixed 32px gutter and the measure. Fixed is the
  // point — everything the row says about its state is said in the gutter, so
  // switching states can never reflow the passage.
  assert.match(css, /--verse-gutter: 32px/);
  assert.match(css, /\.verse-line\s*\{[\s\S]*display: grid;/);
  assert.match(css, /\.verse-line\s*\{[\s\S]*grid-template-columns: var\(--verse-gutter\) minmax\(0, 1fr\);/);

  assert.match(css, /\.verse-line:hover,\s*\.verse-line\.selected \{\s*background: transparent;\s*\}/);

  // State lives in the gutter as a 2px seal mark, sized to the verse's first
  // line rather than centred on the row: it points at where the verse starts.
  assert.match(css, /\.verse-line::before\s*\{[\s\S]*width: 2px;/);
  assert.match(css, /\.verse-line::before\s*\{[\s\S]*border-radius: 0 var\(--radius-mark\) var\(--radius-mark\) 0;/);
  assert.match(css, /\.verse-line::before\s*\{[\s\S]*background: var\(--study-gold\);/);
  assert.match(css, /\.verse-line::before\s*\{[\s\S]*height: 0;/);
  assert.match(css, /\.verse-line\.selected::before\s*\{\s*height: calc\(var\(--fs-reading\) \* var\(--lh-reading\)\);\s*\}/);
  // Hover and focus live in the gutter too: ink on the number, and for focus a
  // short mark. Neither reaches the prose.
  assert.match(css, /\.verse-line:hover \.verse-num\s*\{[\s\S]{0,120}color: var\(--text-tertiary\);/);
  assert.match(css, /\.scripture-content \.verse-line:focus::before\s*\{\s*height: 18px;\s*background: var\(--study-gold\);\s*\}/);
  assert.match(css, /\.scripture-content \.verse-line:focus-visible \.verse-num\s*\{[\s\S]{0,120}color: var\(--text-primary\);/);
  assert.match(css, /\.verse-line\.selected \.verse-num\s*\{[\s\S]*color: var\(--text-primary\);/);
  // A highlighted verse keeps its own hue in the gutter rather than being
  // overprinted with a generic accent that belongs to no colour on the page.
  assert.doesNotMatch(css, /\.verse-line\.selected\s*\{\s*background:\s*rgba\(61,\s*107,\s*181/);
  for (const hue of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.match(css, new RegExp(`\\.verse-line\\.selected\\.hl-${hue}::before \\{ background: var\\(--hl-${hue}-mark\\); \\}`));
  }
});

test("no verse row state ever washes the measure", () => {
  // Selection stops tinting the measure. That space belongs to highlights, and
  // two washes competing over the same words is how a reader loses track of
  // which one is theirs. Every row state — hover, focus, selected, multi- and
  // mixed-select — has to be said in the gutter instead, so no rule targeting
  // the row itself (as opposed to its ::before mark) may carry a fill.
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.verse-line\b/.test(selector) || /::before|::after/.test(selector)) continue;
    for (const value of [...body.matchAll(/(?:^|[\s;])background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim())) {
      assert.match(
        value,
        /^(?:transparent|none)$/,
        `${selector} puts a wash back on the measure (background: ${value})`,
      );
    }
  }
});

test("text selection is the seal at 18%, and says so exactly once", () => {
  // Seal at 18% is distinct from every highlight hue, so a reader can always
  // tell their own colour from a transient selection. A second ::selection rule
  // does not add a second option — it silently replaces the first one.
  const selectionRules = [...css.matchAll(/\.scripture-content ::selection\s*\{([^}]*)\}/g)].map((m) => m[1]!.trim());
  assert.deepEqual(
    selectionRules,
    ["background: color-mix(in srgb, var(--study-gold) 18%, transparent);"],
    "the reading canvas declares one ::selection fill, and it is the seal at 18%",
  );
});

test("chapter changes reset the reading position and the chapter end continues with focus", () => {
  assert.match(page, /contentRef\.current\.scrollTop = 0/);
  assert.match(page, /shouldFocusChapterHeading\.current = false;\s*chapterHeadingRef\.current\?\.focus\(\)/);
  assert.match(page, /<footer className="chapter-end">/);
  assert.match(page, /Continue to \{displayBookName\} \{chapter \+ 1\}/);
  assert.match(page, /shouldFocusChapterHeading\.current = true;/);
});
