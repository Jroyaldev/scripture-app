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

test("verse rows use quiet material states and keyboard spatial navigation", () => {
  assert.match(page, /event\.key === "ArrowUp"/);
  assert.match(page, /event\.key === "ArrowDown"/);
  assert.match(page, /event\.key === "Home"/);
  assert.match(page, /event\.key === "End"/);
  assert.match(page, /verseRowRefs\.current\.get\(targetVerse\)\?\.focus\(\)/);
  assert.match(css, /\.verse-line\s*\{[\s\S]*display: grid;/);
  assert.match(css, /\.verse-line:hover\s*\{[\s\S]*color-mix/);
  assert.match(css, /\.verse-line\.selected\s*\{[\s\S]*var\(--study-gold\)/);
  assert.doesNotMatch(css, /\.verse-line\.selected\s*\{\s*background:\s*rgba\(61,\s*107,\s*181/);
});

test("chapter changes reset the reading position and the chapter end continues with focus", () => {
  assert.match(page, /contentRef\.current\.scrollTop = 0/);
  assert.match(page, /shouldFocusChapterHeading\.current = false;\s*chapterHeadingRef\.current\?\.focus\(\)/);
  assert.match(page, /<footer className="chapter-end">/);
  assert.match(page, /Continue to \{displayBookName\} \{chapter \+ 1\}/);
  assert.match(page, /shouldFocusChapterHeading\.current = true;/);
});
