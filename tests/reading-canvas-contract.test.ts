import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");
const canvas = readFileSync(join(repoRoot, "src", "renderer", "styles", "canvas.css"), "utf-8");

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

test("the gutter carries a note dot and a loading rule, and neither is a grid item", () => {
  // Two of the six states the gutter carries. "Has your note" is a 4px seal
  // dot; "loading this verse's apparatus" is a 14px seal rule where the number
  // goes. Both are announced in the gutter and nowhere else.
  assert.match(page, /hasNote && <span className="verse-note-dot" aria-hidden="true" \/>/);
  assert.match(page, /apparatusLoading && <span className="verse-apparatus-tick" aria-hidden="true" \/>/);
  assert.match(canvas, /\.verse-note-dot\s*\{[\s\S]*width: 4px;\s*height: 4px;\s*border-radius: 50%;\s*background: var\(--study-gold\);/);
  assert.match(canvas, /\.verse-apparatus-tick\s*\{[\s\S]*height: 1px;\s*background: var\(--study-gold\);/);

  // The load of the whole thing: both marks are OUT OF FLOW. A grid item in the
  // gutter track could widen it, and a wider gutter reflows the passage — which
  // is the one thing the reserved gutter exists to make impossible.
  for (const mark of ["\\.verse-note-dot", "\\.verse-apparatus-tick"]) {
    assert.match(canvas, new RegExp(`${mark}\\s*\\{[\\s\\S]*?position: absolute;[\\s\\S]*?\\}`));
  }

  // The number's box survives the loading swap. `visibility` holds the box, the
  // line box and the baseline; `opacity` or `display` would not.
  assert.match(canvas, /\.verse-line\.apparatus-loading \.verse-num\s*\{\s*visibility: hidden;/);

  // A threshold, not motion: the apparatus query normally beats a frame, and a
  // rule that appeared instantly would blink on every navigation.
  assert.match(canvas, /animation: verse-apparatus-tick-in var\(--transition-fast\) 260ms both;/);
  assert.match(canvas, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.verse-apparatus-tick\s*\{\s*animation-duration: 1ms;/);
});

test("the page's own bottom is 40px of paper, not a shadow and not a line", () => {
  // The text continues under the leaf's edge. A shadow there would read as a
  // second plane, and a rule would draw a boundary the page does not have.
  // It hangs on the stage, not inside .scripture-content: the page IS the
  // scroll container, so anything inside it scrolls away with the verses.
  const fade = canvas.match(/\.scripture-reading-stage::after\s*\{([^}]*)\}/)?.[1];
  assert.ok(fade, "the reading stage carries the page's bottom fade");
  assert.match(fade, /height: 40px;/);
  assert.match(fade, /border-radius: 0 0 var\(--radius-page\) var\(--radius-page\);/);
  assert.match(fade, /background: linear-gradient\(/);
  assert.doesNotMatch(fade, /box-shadow|border(?!-radius)/);
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

test("no later rule overrides the gutter's hover and focus ink", () => {
  // The gutter states are stated once each, and the LAST rule wins — which is
  // how this broke. A trailing
  //   `.scripture-content .verse-line:focus .verse-num,
  //    .verse-line:hover .verse-num { color: var(--text-secondary); }`
  // matched at exactly the specificity of both correct rules and came after
  // them, so hover quietly moved off ink-3 (D draws hovered as ".8", #928C84)
  // and focus-visible lost its ink altogether — `:focus-visible` also matches
  // `:focus`, so the clash was invisible in the source.
  //
  // Asserting the correct rules exist cannot catch this; a regex is happy to
  // match the loser. So walk every declaration in document order and check
  // that the last one to claim each state is the right one.
  const winners = new Map<string, string>();
  for (const [selector, body] of ruleBlocks()) {
    const colour = [...body.matchAll(/(?:^|[\s;])color:\s*([^;]+);/g)].pop()?.[1]?.trim();
    if (!colour) continue;
    for (const part of selector.split(",").map((s) => s.trim())) {
      if (!/\.verse-num$/.test(part)) continue;
      if (/:hover \.verse-num$/.test(part)) winners.set("hover", colour);
      if (/:focus(?:-visible)? \.verse-num$/.test(part)) winners.set("focus", colour);
    }
  }
  assert.equal(winners.get("hover"), "var(--text-tertiary)",
    "the hovered verse number is ink-3; a later rule has taken it somewhere else");
  assert.equal(winners.get("focus"), "var(--text-primary)",
    "a focused verse number goes to ink like a selected one; a later rule has taken it somewhere else");
});

test("a connection wears its kind's ink, and the word at the spine confirms it", () => {
  // REWRITTEN 2026-07-30 by the connections revival — a dated reversal of
  // Rev 04 §5's two-ink ruling, which this test used to hold ("seal or faint,
  // never a hue of its own"). The reader ruled the Era-3 C0.5 paint (64d0e5f)
  // the canon for connections, and per-kind ink is load-bearing in it: a
  // parallel reads slate and a contrast terracotta before a single word is
  // read. The legend problem Rev 04 feared is answered Era 3's way — the kind
  // WORD still sits at the spine's head, so the hue is confirmation, not code.
  const inks = new Set<string>();
  for (const [selector, body] of ruleBlocks()) {
    if (!/^\.connection-kind-\w+$/.test(selector)) continue;
    for (const value of [...body.matchAll(/--connection-ink:\s*([^;]+);/g)]) inks.add(value[1]!.trim());
  }
  assert.deepEqual([...inks].sort(), [
    "var(--mark-contrast)",
    "var(--mark-echo)",
    "var(--mark-hinge)",
    "var(--mark-mirror)",
    "var(--mark-parallel)",
    "var(--mark-series)",
  ], "the six kinds carry the six marking inks, one each, off the shared --mark-* table");
  // The resting default is still ink-3, and the marking selection is still
  // seal — provenance keeps its colour where provenance is the message.
  assert.match(css, /\.connection-mark,\s*\.connection-emphasis-mark \{\s*--connection-ink: var\(--text-tertiary\);/);
  assert.match(css, /\[data-paint-state="selection"\] \{[\s\S]{0,80}--connection-ink: var\(--study-gold\)/);
  // A quiet run whose owners disagree falls back to ink-faint on the datum;
  // a gutter tick still floats in open air and still owes Law 6's 3:1, so
  // ink-faint stays off the tick layer.
  assert.match(css, /\.connection-underline \{[\s\S]{0,700}stroke: var\(--connection-ink, var\(--ink-faint, #C8C2B8\)\)/);
  assert.doesNotMatch(css, /\.connection-tick[^{]*\{[^}]*var\(--ink-faint/,
    "a tick is a wordless mark in open air, and owes 3:1");
});

test("the veil dims the chapter only inside a selection, and in the page's own paper", () => {
  // REWRITTEN 2026-07-30 by the connections revival — a dated reversal of
  // Rev 04 §5, which deleted the focus veil at the source and which this test
  // used to enforce ("the veil is deleted, not neutralised"). The reader
  // ruled the Era-3 atmosphere (64d0e5f) the canon, and the veil is its
  // deepest breath. What is pinned now is the discipline that makes it
  // liveable: the sheet is the reading page's own paper, it reaches .56 (.52
  // in the dark) only once a selection exists, the attended words keep full
  // ink through a luminance hole, and nothing paints it at rest.
  assert.match(css, /\.connection-focus-veil \{[\s\S]{0,240}fill: var\(--connection-focus-veil-color\)/,
    "the veil is the reading page's own paper, not a foreign scrim");
  assert.match(css, /\.connection-focus-veil \{[\s\S]{0,240}opacity: 0;/,
    "unready, the veil does not paint");
  assert.match(css, /\.connection-focus-veil\.is-ready \{ opacity: \.56; \}/);
  assert.match(css, /\.dark \.connection-focus-veil\.is-ready \{ opacity: \.52; \}/);
  const underlay = readFileSync(join(repoRoot, "src/renderer/components/ConnectionUnderlay.tsx"), "utf8");
  assert.match(underlay, /selectedConnectionId && focusHasExactPaint && <rect/,
    "the rect exists only under an explicit selection with exact paint");
  assert.match(underlay, /className="connection-focus-mask"/,
    "the holes are cut by a luminance mask, so the attended words keep full ink");
  // And the wash plane recedes in the same breath: dormant fields go to 0
  // while anything is attended.
  assert.match(css, /\.connection-emphasis-underlay\.is-awake\s*\.connection-emphasis-mark\[data-paint-state="dormant"\]\s*\.connection-emphasis-wash \{ fill-opacity: 0; \}/);
});

test("the thread draws itself on from the underline, and holds still under a pointer", () => {
  // REWRITTEN 2026-07-30 by the connections revival — a dated reversal of
  // Rev 04 §5's "the route never traces along its own path", which this test
  // used to enforce by banning every geometry transition. The reader ruled
  // the Era-3 choreography (64d0e5f) the canon: the route draws on over 340ms
  // on the C0.5 curve after a 40ms breath, the attended underline extends
  // over 300ms, and the contact blooms .72 -> 1 on a 90ms delay behind the
  // route's arrival. Reduced motion swaps every one of these for the instant
  // terminal state, and that is pinned here too.
  const attendFade = css.match(/--connection-attend-fade:\s*([^;]+);/)?.[1] ?? "";
  assert.match(attendFade, /^140ms\b/, "the kind word and tick marks still fade on the 140ms token");
  const route = css.match(/\.connection-route\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(route,
    /transition: stroke-dashoffset 340ms cubic-bezier\(\.22, \.72, \.2, 1\) 40ms, opacity 180ms ease 40ms/,
    "the route draws on over 340ms after a 40ms breath");
  const underline = css.match(/\.connection-underline\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(underline, /stroke-dashoffset 300ms cubic-bezier\(\.3, \.7, \.3, 1\)/,
    "the attended underline extends over 300ms");
  // (The first `.connection-contact` token in the sheet is the grouped
  // vector-effect rule, so the bloom rule is matched by its own body.)
  assert.match(css, /\.connection-contact \{[^}]*transition: opacity 200ms ease 90ms, transform 200ms ease 90ms/,
    "the contact blooms behind the route's arrival");
  assert.match(css,
    /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.connection-focus-veil,[^@]*\.connection-underline,[^@]*transition: none !important;/,
    "reduced motion swaps the choreography for the instant terminal state");
  // The datum half of the canon is untouched: strokes widen symmetrically
  // about the fixed centre, so nothing moves sideways or downward.
  assert.match(underline, /stroke-width: var\(--connection-underline-quiet-width, 1px\)/);
  // Reserve survives where it was right: hover reveals still change opacity
  // and ink, never geometry. The tick may not grow under the pointer.
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.connection-tick[.:][^,]*(?:hover|focused)[^,]*\.connection-tick-dash/.test(selector)) continue;
    assert.doesNotMatch(body, /width|height|transform|padding|margin/,
      `${selector} moves the mark on hover instead of changing its ink`);
  }
});

test("chapter changes reset the reading position and the chapter end continues with focus", () => {
  assert.match(page, /contentRef\.current\.scrollTop = 0/);
  assert.match(page, /shouldFocusChapterHeading\.current = false;\s*chapterHeadingRef\.current\?\.focus\(\)/);
  assert.match(page, /<footer className="chapter-end">/);
  assert.match(page, /Continue to \{displayBookName\} \{chapter \+ 1\}/);
  assert.match(page, /shouldFocusChapterHeading\.current = true;/);
});
