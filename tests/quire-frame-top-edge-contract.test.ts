import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

/**
 * Rev 05 §05·3, row one of the frame table.
 *
 *   Page top · 54 · Window top: 24 study line + 30 strip. Invariant across modes.
 *
 * This file exists because three surfaces now derive from that one number and
 * none of them owns it. The register composes it (§05·2), the rail aligns its
 * brand tile's top edge to it (§05·3), and the page grid measures its rectangle
 * from it (§05·4–6) — "so it must be exact, not approximate". A number that
 * three agents read and one agent writes is exactly the kind of shared datum
 * §05·2 was written about, so it is pinned here rather than in any one of their
 * contracts.
 */

const read = (path: string): string =>
  readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

/**
 * The sheets in this repo carry their reasoning in comments, and a retirement
 * is recorded by quoting the rule that was retired. A negative assertion that
 * reads the comments would therefore fail on the very note that proves the
 * device is gone, so every "this may not come back" check below is made against
 * declarations only.
 */
const declarationsOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

const styles = declarationsOnly(read("src/renderer/styles.css"));
const register = declarationsOnly(read("src/renderer/styles/register.css"));
const rail = declarationsOnly(read("src/renderer/styles/rail.css"));
const canvas = declarationsOnly(read("src/renderer/styles/canvas.css"));
const tooltip = read("src/renderer/components/Tooltip.tsx");

const sheets: ReadonlyArray<{ name: string; source: string }> = [
  { name: "styles.css", source: styles },
  { name: "styles/register.css", source: register },
  { name: "styles/rail.css", source: rail },
  { name: "styles/canvas.css", source: canvas },
];

function declarationsOf(token: string): Array<{ sheet: string; value: string }> {
  const found: Array<{ sheet: string; value: string }> = [];
  for (const { name, source } of sheets) {
    const pattern = new RegExp(`${token}\\s*:\\s*([^;]+);`, "g");
    for (const match of source.matchAll(pattern)) {
      found.push({ sheet: name, value: match[1].trim() });
    }
  }
  return found;
}

const px = (value: string): number => Number.parseFloat(value.replace("px", ""));

/**
 * The page's top edge, read from the sheets rather than written down here.
 *
 * Nothing in this file may state the number as a literal. It is composed from
 * two declarations and it has moved twice — 54 while the canvas was 24, 40
 * since the frame was re-canonned at a 10px inset — and both moves were
 * deliberate. What may not move is the mirror in Tooltip.tsx, which drifted
 * silently through the second one because this file pinned `= 54` as text
 * instead of as arithmetic on the sheets.
 */
const FRAME_TOP = px(declarationsOf("--study-line")[0]!.value)
  + px(declarationsOf("--register-strip")[0]!.value);

test("the page's top edge is 54, and it is composed rather than asserted", () => {
  /* The number is never written down. It is a 24px study line — the drag band,
     with the study chips standing in it — over a 30px tab strip, and the sum is
     what the other two surfaces read.

     THE FIRST HALF WAS RENAMED ON 2026-07-30 and the sum went back to 54. It
     used to be --page-inset, and the coincidence was real for one day: commit
     e8e2ee9 re-canonned the frame to a 10px inset and the band above the tabs
     happened to be that same 10. §05·2 had specified the band as "24 and
     nothing else", so at 10 the band was two thirds gone and its "and nothing
     else" was the whole of it — too thin to drag a window by and holding
     nothing. The study line takes the band over: the same region, still the
     window's drag region, now with a row of chips in it. The page's own inset
     is still 10 and is no longer half of the frame's top edge, which is the
     honest arrangement — two facts that were never the same fact are no longer
     spelled with one token.

     What this test defends is unchanged, and it is why the rename could be made
     safely: the edge is composed from two declarations, each stated exactly
     once, and read by three surfaces that do not own it. */
  const line = declarationsOf("--study-line");
  const strip = declarationsOf("--register-strip");
  const frame = declarationsOf("--frame-top");

  assert.equal(line.length, 1, "--study-line is declared once");
  assert.equal(strip.length, 1, "--register-strip is declared once");
  assert.equal(frame.length, 1, "--frame-top is declared once");

  assert.equal(line[0].value, "24px");
  assert.equal(strip[0].value, "30px");
  assert.match(frame[0].value, /^calc\(var\(--study-line\) \+ var\(--register-strip\)\)$/);

  // And the sum is 54. Written as arithmetic on the two declared values so the
  // test fails when either half moves, rather than when someone edits a comment.
  assert.equal(px(line[0].value) + px(strip[0].value), 54);
  assert.equal(FRAME_TOP, 54);

  // The page's inset is still declared once and is still 10; it is simply not
  // part of this sum any more. Asserted so the rename cannot be undone by
  // accident, in either direction.
  const inset = declarationsOf("--page-inset");
  assert.equal(inset.length, 1, "--page-inset is declared once");
  assert.equal(inset[0].value, "10px");
  assert.doesNotMatch(frame[0].value, /--page-inset/,
    "the frame's top edge is the study line over the strip, not the paper's inset over it");
});

test("the top edge does not vary by mode, by width, or by atmosphere", () => {
  // "54px in every mode and at every window size." A mode block that redeclared
  // either half — narrow, forced colours, or any of the atmospheres — would move
  // the page's top edge under the rail and the page grid without either of them
  // being able to see it, which is the four-datums fault reproduced across three
  // files instead of within one band. The uniqueness assertions above already
  // forbid a second declaration; this one holds the geometry that reads them.
  const bar = styles.slice(
    styles.indexOf(".scripture-workspace-bar {"),
    styles.indexOf("}", styles.indexOf(".scripture-workspace-bar {")),
  );
  /* THE BAR IS HALF THE FRAME NOW, 2026-07-30. These two lines read
       assert.match(bar, /height: var\(--frame-top\);/);
       assert.match(bar, /padding: var\(--page-inset\) var\(--page-inset\) 0 0;/);
     from when the band above the tabs was the bar's own empty top padding and
     the bar therefore stood for the whole edge. The study line is a real
     element in that band now and owns its height, so a bar still claiming
     --frame-top would claim it twice and the page's top edge would land at 78.
     The claim being defended is the same one and is if anything sharper: each
     half of the sum is declared by exactly one element, and neither may state a
     second height. */
  assert.match(bar, /height: var\(--register-strip\);/);
  assert.match(bar, /padding: 0 var\(--page-inset\) 0 0;/);
  const line = styles.slice(
    styles.indexOf(".scripture-study-line {"),
    styles.indexOf("}", styles.indexOf(".scripture-study-line {")),
  );
  assert.match(line, /height: var\(--study-line\);/);
  assert.match(line, /flex: 0 0 auto;/);
  assert.doesNotMatch(line, /min-height/);
  // And the two halves are siblings in the page's column, in that order — the
  // line above the strip. Between the strip and the page is the one place a
  // second row may not go: the active tab's fillets join it to --bg-reading at
  // the strip's baseline, and a row inserted there severs the joint that makes
  // the tab a piece of the page.
  const page = read("src/renderer/components/ScripturePage.tsx");
  assert.ok(
    page.indexOf("<StudyLine") < page.indexOf("<ScriptureWorkspaceTabs"),
    "the study line stands above the strip, in the band, not between the strip and the page",
  );
  // A floor is what let the band grow in the first place — the retired group
  // bracket opened a 15px lane above the tabs and the edge moved 54 → 69 with
  // the register's contents. The height is stated, and no other rule anywhere
  // may restate it.
  assert.doesNotMatch(bar, /min-height/);
  for (const { name, source } of sheets) {
    for (const [, selector, body] of source.matchAll(/([^{};]*\.scripture-(?:workspace-bar|study-line)[^{};]*)\{([^}]*)\}/g)) {
      // Only rules whose SUBJECT is the bar itself. A rule that merely scopes
      // itself to the bar sizes something inside it — the failure line's retry
      // button has a 24px target, and the seal baseline is a 1px pseudo-element
      // — and neither has anything to do with the bar's own box.
      const subjectIsFrameRow = selector
        .split(",")
        .map((one) => one.trim().split(/[\s>+~]+/).at(-1) ?? "")
        .some((subject) => (subject.startsWith(".scripture-workspace-bar")
          || subject.startsWith(".scripture-study-line")) && !subject.includes("::"));
      if (!subjectIsFrameRow) continue;
      if (body === bar.slice(bar.indexOf("{") + 1)) continue;
      if (body === line.slice(line.indexOf("{") + 1)) continue;
      assert.doesNotMatch(
        body,
        /(?:^|[\s;])(?:min-)?height\s*:/,
        `${name} gives a frame row a second height`,
      );
    }
  }

  // The strip's half of the sum is the tab, and the tab reads the token rather
  // than restating 30 — the two cannot drift apart while that holds.
  assert.match(styles, /\.scripture-workspace-tab \{[\s\S]{0,460}height: var\(--register-strip\);/);

  // And where there is no strip, the 54 is reserved anyway. Focus does not
  // render a register, so without this the page's top edge would rise to 0 in
  // the one mode whose whole claim is that "the rectangle does not change. Top
  // 54, left 80, right and bottom 24 — identical to reading mode." The rule is
  // rev05-canon's and lives on the page grid; it is pinned here because this is
  // where the invariant is stated, and because it is keyed on the STRIP's
  // absence rather than on focus-mode — the row says "invariant across modes",
  // not "across the two modes that exist today".
  // This required `padding-top: var(--frame-top)` — "a mode that drops the
  // register must still reserve the frame's top edge." The reserve was right
  // when the page was inset by a different number on every side, because 54 top
  // and 24 elsewhere is frame either way. The page fills to its own inset now,
  // so 54 against 24 is a visible mismatch rather than a structural one, and it
  // was reported as one.
  //
  // 54 is 24 of canvas plus a 30px register strip. Where no strip renders there
  // is nothing for the 30 to hold, and what remains is the page's own inset —
  // the same correction already made for the rail's band on the other axis, and
  // the third time this shape appeared: space reserved for a thing that mode
  // does not draw.
  assert.match(
    styles,
    /\.scripture-page:not\(:has\(> \.scripture-workspace-bar\)\) > \.scripture-body \{\s*padding-top: var\(--page-inset\);\s*\}/,
    "a mode that drops the register reserves the page's own inset, not the strip's",
  );

  // THIS IS HALF OF ONE CLAIM, and the other half is in
  // tests/quire-rev05-rail-frame-contract.test.ts. §05·5's rectangle is four
  // edges, and focus was breaking two of them independently: the top rose to 0
  // because no register was rendered (the rule above), and the left fell to 36
  // because `.app-shell.focus-mode > .sidebar` was A4's 12px stub, since
  // restored to var(--rail-w-collapsed). Neither fix reaches the rectangle
  // alone — one restores 54, the other restores 80 — so a reader who finds only
  // one of these two assertions will think the invariant is guarded when half
  // of it is. Measured together in a real window at 1280/1328/1600, focus and
  // reading now agree on all four edges with zero overflow, which is the only
  // claim in Rev 05 that needed two regions to land before it became true.
  //
  // Not asserted as one thing here on purpose: a source-reading test cannot see
  // a used layout, and the composite was established by probing a real browser.
  // What is guarded is each half at the place it is declared, plus this note so
  // the halves are discoverable from each other.
});

test("the band holds the study line, and the register still draws nothing above its tabs", () => {
  /* §05·2: "The drag band is 24 and nothing else."

     RESTATED 2026-07-30, because the band has contents now and the sentence has
     to say which contents it ever forbade. What §05·2 was ruling out is two
     objects that the REGISTER drew into the lane above its own tabs: a group's
     hairline, carried in segments by every member and trimmed at the run's end,
     and the study siglum, floating in the band at a third x. Both were the
     register measuring itself against a datum nobody owned, which is the fault
     the whole section is about, and both stay retired.

     The study line is not that. It is a sibling of the bar with its own stated
     height, one of the two halves the frame's top edge is composed from, and it
     is what the band was reserved for in the first place — the window's drag
     region. Nothing in the register reaches into it, and the register still may
     not reserve a pixel above its tabs. These are the names both retired
     devices went by. */
  assert.doesNotMatch(styles, /scripture-workspace-group-rule/);
  assert.doesNotMatch(register, /scripture-workspace-group-rule \{/);
  assert.doesNotMatch(styles, /data-study-group-bracket/);

  // And no tab may open a lane above itself: the wrap's padding-top was the
  // mechanism, so a padding-top on any wrap is the defect returning.
  const wraps = [...styles.matchAll(/\.scripture-workspace-tab-wrap[^{}]*\{([^}]*)\}/g)];
  assert.ok(wraps.length > 0, "the tab wrap must still be styled");
  for (const [, body] of wraps) {
    assert.doesNotMatch(body, /padding-top\s*:\s*(?!0)/, "nothing may be reserved above the tab row");
  }

  /* THE BAND IS THE WINDOW'S, AND IT IS EMPTY · RESTATED 2026-08-03.
     This used to check that the row drags AND that every control standing in it
     opts back out, because a drag region swallows the press before the element
     under the pointer ever sees it. Both halves were true and the pair was still
     the defect: a drag region interrupted by a dozen no-drag boxes is not a drag
     region, it is the gaps between them, and the maintainer could not grab the
     window. The chips are in the register now — see tests/study-control-contract
     — and what is asserted here is the stronger claim the opt-out was standing
     in for: the row drags, and there is nothing in it to opt out. */
  const line = styles.slice(
    styles.indexOf(".scripture-study-line {"),
    styles.indexOf("}", styles.indexOf(".scripture-study-line {")),
  );
  assert.match(line, /-webkit-app-region: drag;/);
  assert.doesNotMatch(styles, /\.scripture-study-chip\b/,
    "the chips are gone from the sheet, not merely unmounted");
  assert.match(
    read("src/renderer/components/ScripturePage.tsx"),
    /<div className="scripture-study-line" data-study-drag-band="" \/>/,
    "the band is a leaf: nothing can be pressed in it because nothing is in it",
  );
  /* The tooltip primitive's own wrapper had to opt out too, because it is a real
     span between the band and the control inside it and a drag region swallows
     the press at whichever element it reaches first. That is still true wherever
     a tooltipped control stands in a drag region — it is asserted on the study
     control's own anchor now, one row down, where the tooltip actually is. */
  assert.match(
    styles,
    /\.scripture-study-control \.control-tooltip-anchor \{\s*-webkit-app-region: no-drag;/,
    "a tooltip wrapper around a control opts out wherever that control stands",
  );
});

test("no tooltip may open into the band", () => {
  // §05·2's third deletion: "Tooltips open below their control, inside the page,
  // or not at all." The primitive mirrors the frame's top edge, and this is the
  // assertion that keeps the mirror honest — the CSS token is the authority, but
  // a placement rule cannot parse an unregistered custom property at runtime.
  //
  // This line used to read `assert.match(tooltip, /const PAGE_TOP_EDGE = 54;/)`,
  // and on 2026-07-30 it was pinning a 14px lie: the frame had been re-canonned
  // to 40 and the mirror was still on 54, so a contract written to catch exactly
  // this drift was instead holding it in place. A literal cannot police a
  // composed number. The expectation is now BUILT from the two declarations the
  // sheets make, so the sheets remain the authority and the mirror is checked
  // against them rather than against a copy of them made at some past date.
  assert.match(tooltip, new RegExp(`const PAGE_TOP_EDGE = ${FRAME_TOP};`),
    `Tooltip.tsx must mirror the frame's composed top edge (${FRAME_TOP})`);
  assert.match(tooltip, /export function tooltipPlacement\(/);
  // Below first, always; above is the one fallback and only inside the page.
  assert.match(tooltip, /if \(below \+ tooltipHeight <= viewportHeight - VIEWPORT_MARGIN\)/);
  assert.match(tooltip, /if \(above >= pageTopEdge\) return \{ top: above, side: "top" \};/);
  assert.match(tooltip, /return null;/);
});

test("tooltipPlacement prefers below, falls back inside the page, and otherwise declines", async () => {
  const { tooltipPlacement } = await import("../src/renderer/components/Tooltip.js");

  // A control in the strip: the atmosphere hint's own case. Below is free, so
  // the tooltip opens into the page and never over the drag band.
  assert.deepEqual(
    tooltipPlacement(24, 54, 30, 900),
    { top: 62, side: "bottom" },
    "a control in the strip opens downward into the page",
  );

  // A control at the foot of a tall window: no room below, plenty above, and the
  // tooltip stays well inside the page.
  assert.deepEqual(
    tooltipPlacement(700, 730, 30, 760),
    { top: 662, side: "top" },
    "a control at the bottom edge may open upward inside the page",
  );

  // The case the section names. A control high in the window with nothing below
  // it: opening upward would land the tooltip on the drag region and across the
  // tab strip, so it is not drawn at all.
  assert.equal(
    tooltipPlacement(60, 90, 40, 96),
    null,
    "a tooltip with nowhere legal to go is not drawn",
  );

  // The boundary is the page's top edge itself, not the window's: a tooltip that
  // would end exactly on the edge is allowed, one pixel higher is not.
  //
  // Stated relative to FRAME_TOP rather than as the four literals it used to be
  // (102/132/140 and an expected top of 54). Those literals encoded the old edge
  // and would have had to be recomputed by hand every time the frame moves,
  // which is the same failure mode as the mirror above: a number copied out of
  // the sheets and then left behind by them. A tooltip of height 40 clears the
  // edge exactly when its anchor's top is edge + 40 + TOOLTIP_GAP.
  assert.deepEqual(
    tooltipPlacement(FRAME_TOP + 48, FRAME_TOP + 78, 40, FRAME_TOP + 86),
    { top: FRAME_TOP, side: "top" },
    "a tooltip that ends exactly on the page's top edge is allowed",
  );
  assert.equal(
    tooltipPlacement(FRAME_TOP + 47, FRAME_TOP + 77, 40, FRAME_TOP + 85),
    null,
    "one pixel higher is not",
  );
});
