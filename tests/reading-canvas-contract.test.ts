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

test("a connection is seal or it is faint, and never a hue of its own", () => {
  // The rationale used to be quoted from D·2, which Rev 04 §8 withdraws in its
  // entirety; the ruling itself survives verbatim in Rev 04 §5, so only the
  // citation moves. The six kinds are "never abbreviated, never iconified,
  // never colour-coded, always set in the UI sans" — hue is already committed
  // to provenance, and seal means a human did this.
  const inks = new Set<string>();
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.connection-(?:mark|emphasis-mark|tick)\b/.test(selector)) continue;
    for (const value of [...body.matchAll(/--connection-ink:\s*([^;]+);/g)]) inks.add(value[1]!.trim());
  }
  assert.deepEqual([...inks].sort(), ["var(--study-gold)", "var(--text-tertiary)"],
    "the mark and tick layer knows exactly two inks: ink-3 at rest, the seal when attended");
  // Ink-faint is the underline's resting ink specifically, and not this
  // layer's. §5 puts a resting member "in ink-faint #C8C2B8" where it sits
  // against measured glyph ink; a gutter tick floats in air with nothing
  // beside it, so Law 6 gives it the 3:1 floor for a wordless mark and
  // #C8C2B8 (about 1.5:1 on paper) cannot carry it.
  assert.match(css, /\.connection-underline \{[\s\S]{0,600}stroke: var\(--ink-faint, #C8C2B8\)/);
  assert.doesNotMatch(css, /\.connection-tick[^{]*\{[^}]*var\(--ink-faint/,
    "a tick is a wordless mark in open air, and owes 3:1");
  // Kind is carried by the word at the spine's head, never by colour.
  assert.doesNotMatch(css, /\.connection-kind-\w+\s*\{[^}]*--connection-ink/);
});

test("the thread never dims the page to make itself findable", () => {
  // The veil was a full-page sheet of paper at 56% with a hole cut for the
  // attended connection: scripture washed out so a 1px rule would read. It is
  // a plane violation too — translucent paper over paper is a third plane, and
  // this one covered the words. Rev 04 §5 settles it: "Every other member
  // stays ink-faint and does not dim."
  //
  // This test used to REQUIRE the veil rule to still be declared — "the veil
  // rule is still declared, so it is still being held down" — and then check
  // it was inert at `fill: none; opacity: 0`. That was the right test while
  // the rect was emitted by a component this sheet did not own: a deleted rule
  // would have let the rect paint again. Rev 04 puts the connection language
  // and ConnectionUnderlay in one pair of hands, so the rect, its mask and its
  // ready-state are deleted at the source and there is nothing left to hold
  // down. Requiring the CSS gravestone now would forbid the actual fix.
  assert.doesNotMatch(css, /connection-focus-veil|connection-focus-mask/,
    "the veil is deleted, not neutralised");
  assert.doesNotMatch(
    readFileSync(join(repoRoot, "src/renderer/components/ConnectionUnderlay.tsx"), "utf8"),
    /focus-veil|focusMaskId|veilReady/,
    "no component still emits the rect the CSS used to hold down",
  );
  // Nothing else on this layer may dim a member to promote another, either.
  assert.doesNotMatch(css, /\.connection-emphasis-underlay\.is-awake/,
    "a woken connection does not push the others back");
});

test("the thread appears rather than drawing itself on, and holds still under a pointer", () => {
  // Rev 04 §5: "Attend fades in over 140ms. The route never traces along its
  // own path. Selection thickens the stroke symmetrically about the fixed
  // centre datum, so nothing moves." stroke-dashoffset is the draw-on, so it
  // may be set but never transitioned.
  //
  // The duration used to be pinned at 120ms, from D·2's motion table. Rev 04
  // names 140 for attend specifically, and §9's scale is 120 / 140 / 180 with
  // no fourth. 140 is not one of the four --transition-* tokens, and this
  // sheet's token blocks belong to another study this cycle, so the connection
  // layer declares it component-scoped and every attend transition reads it.
  const attendFade = css.match(/--connection-attend-fade:\s*([^;]+);/)?.[1] ?? "";
  assert.match(attendFade, /^140ms\b/, "attend fades in over 140ms");
  for (const rule of [".connection-underline", ".connection-route", ".connection-contact"]) {
    const body = css.match(new RegExp(`\\${rule}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(body, `${rule} is declared`);
    const transition = body.match(/transition:\s*([^;]+);/)?.[1] ?? "";
    assert.doesNotMatch(transition, /stroke-dashoffset|transform|stroke-width/,
      `${rule} animates its own geometry; only ink and opacity may move`);
    for (const duration of transition.matchAll(/(\d+)ms/g)) {
      assert.equal(duration[1], "140", `${rule} moves at ${duration[0]}, and attend moves in 140ms`);
    }
  }
  // Both weights are 1.5px, so attention is a change of ink and nothing else.
  // A resting underline that had to grow into its attended weight would be the
  // drawn-on line again, one axis over.
  const underline = css.match(/\.connection-underline\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(underline, /stroke-width: var\(--connection-underline-selected-width, 1\.5px\)/,
    "a member is 1.5px at rest, the same weight it attends at");
  // Reserve: "reveals change opacity and ink, never geometry." The tick used
  // to grow 11px → 15px under the pointer.
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
