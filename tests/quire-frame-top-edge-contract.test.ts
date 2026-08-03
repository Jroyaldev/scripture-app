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
const FRAME_TOP = px(declarationsOf("--register-strip")[0]!.value);

test("the page's top edge is 40, and it is composed rather than asserted", () => {
  /* THE NUMBER HAS NEVER BEEN WRITTEN DOWN and it has moved three times.

     54 while the canvas above the tabs was 24. Then 40, when commit e8e2ee9
     re-canonned the frame to a 10px inset — and the band was two-thirds gone,
     too thin to drag a window by and holding nothing. Then 54 again on
     2026-07-30, when the study line took the band over at §05·2's own 24 and
     put a row of chips in it. And 40 again on 2026-08-03, when those chips went
     into the register and the band dissolved into it with them.

     THE LAST MOVE IS THE ONE THIS TEST WAS WAITING FOR. Each of the first three
     kept a band above the tabs whose only job, once it was empty, was to be
     dragged by — and a drag region is not a row, it is a property a row can
     carry. The register carries it now: one strip at the top of the window with
     the system's buttons inset into its left end, which is what every browser
     on this platform does. Sixteen pixels of window go back to the page.

     What this test defends is unchanged, and it is why each of those moves could
     be made safely: the edge is stated exactly once and read by three surfaces
     that do not own it. It is arithmetic on the sheet rather than a literal, so
     it fails when the value moves and not when someone edits a comment. */
  const strip = declarationsOf("--register-strip");
  const frame = declarationsOf("--frame-top");

  assert.equal(strip.length, 1, "--register-strip is declared once");
  assert.equal(frame.length, 1, "--frame-top is declared once");
  assert.equal(strip[0].value, "40px");
  assert.match(frame[0].value, /^var\(--register-strip\)$/);
  assert.equal(FRAME_TOP, 40);

  /* THE SECOND HALF IS GONE, NOT ZEROED. --study-line was the band's own token
     and it is retired with the band; a `0px` left standing would be a row the
     next feature could grow back, which is exactly the history above. */
  assert.equal(declarationsOf("--study-line").length, 0,
    "the band's token is retired, not set to zero");

  // The page's inset is still declared once and is still 10; it has not been
  // part of this sum since 2026-07-30 and must not become part of it again.
  const inset = declarationsOf("--page-inset");
  assert.equal(inset.length, 1, "--page-inset is declared once");
  assert.equal(inset[0].value, "10px");
  assert.doesNotMatch(frame[0].value, /--page-inset/,
    "the frame's top edge is the register, not the paper's inset over it");

  /* AND THE ROOM MACOS KEEPS FOR ITS OWN BUTTONS is declared once too, because
     the register subtracts the rail from it rather than repeating it. It is a
     platform fact and not ours to tune. */
  const buttons = declarationsOf("--os-buttons");
  assert.equal(buttons.length, 1, "--os-buttons is declared once");
  assert.equal(buttons[0].value, "78px");
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
  /* THE BAR IS THE WHOLE FRAME AGAIN · 2026-08-03, and this has now been true,
     false and true again. It first read

       assert.match(bar, /height: var\(--frame-top\);/);
       assert.match(bar, /padding: var\(--page-inset\) var\(--page-inset\) 0 0;/);

     from when the band above the tabs was the bar's own empty top padding.
     Then the study line became a real element in that band and owned its own
     height, so the bar claimed only --register-strip or it would have claimed
     the edge twice and put the page's top at 78. Now the band is gone and the
     bar is the frame's only row — so it is back to standing for the whole edge,
     and states it in the token it composes from rather than in --frame-top,
     which is derived FROM it. A bar reading --frame-top would be circular.

     The claim being defended has not moved: the edge is declared by exactly one
     element and nothing anywhere may state a second height for it. */
  assert.match(bar, /height: var\(--register-strip\);/);
  assert.doesNotMatch(bar, /height: var\(--frame-top\)/,
    "--frame-top derives from this row; a row reading it back is circular");

  /* THE ROW IS THE WINDOW'S NOW. The band held the drag region and dissolved
     into this, which is the whole reason the row could go: a drag region is not
     a row, it is a property a row can carry. Every control in it opts back out
     — the band failed at exactly this, because 24px studded with no-drag chips
     leaves only the gaps between them, and here the controls sit at the two
     ends with most of the window free between them. */
  assert.match(bar, /-webkit-app-region: drag;/);
  assert.match(styles, /\.scripture-workspace-bar button,\s*\.scripture-workspace-bar input,\s*\.scripture-workspace-bar \[role="tablist"\],\s*\.scripture-workspace-bar \.control-tooltip-anchor \{\s*-webkit-app-region: no-drag;/);

  /* AND IT KEEPS ROOM FOR THE SYSTEM'S OWN BUTTONS, minus whatever the rail is
     already standing in. `max()` is what makes the open rail fall out of the
     same expression rather than needing a rule of its own, and fullscreen —
     where macOS hides the buttons entirely — is the same rule with the reserve
     at zero. */
  assert.match(bar, /padding: 0 var\(--page-inset\) 0 max\(0px, calc\(var\(--os-buttons\) - var\(--rail-flow-w\)\)\);/);
  assert.match(styles, /\.app-shell\[data-fullscreen\] \.scripture-workspace-bar \{\s*padding-left: 0;\s*\}/);

  /* AND THE FIRST TAB'S FILLET IS DROPPED UNCONDITIONALLY, which is the half of
     flush-start that does NOT depend on the reserve.

     A fillet is a joint: a block of paper outside the tab whose outer corner is
     carved away, so the tab sweeps into the page's top edge on a curve. The
     first tab has nothing to its left to sweep into — and while the row reserves
     room for the window's buttons that is MORE true, not less, because the space
     there belongs to the window and holds the system's own controls. Gated on
     the reserve, it drew a wedge of paper under the traffic lights, which is
     what a single-tab window showed. The PAGE's corner is the half that depends
     on the reserve, and it is gated below. */
  assert.match(
    styles,
    /\.scripture-workspace-bar\[data-flush-start\] \.scripture-workspace-tab\[aria-selected="true"\]::before \{\s*display: none;/,
  );
  assert.match(
    styles,
    /\.app-shell\[data-fullscreen\] \.scripture-workspace-bar\[data-flush-start\] ~ \.scripture-body \.scripture-content,/,
    "the page's corner is squared only where the tab actually stands on it",
  );

  /* THE BAND IS GONE FROM THE SHEET AND FROM THE PAGE. Not hidden, not zeroed:
     a 24px row that already exists and holds nothing is the most convenient
     place in the frame for the next feature that needs a home, and everything
     that has ever stood in it has been under the window's buttons, in the way
     of the drag, or on the screen's top edge in fullscreen. */
  assert.doesNotMatch(styles, /\.scripture-study-line\b/, "the band's rules are deleted");
  const page = read("src/renderer/components/ScripturePage.tsx");
  assert.doesNotMatch(page, /scripture-study-line/, "and nothing renders it");
  assert.ok(
    page.indexOf("<ScriptureWorkspaceTabs") < page.indexOf('id="scripture-workspace-panel"'),
    "the strip still meets the page with nothing in between: the fillets join there",
  );
  // A floor is what let the band grow in the first place — the retired group
  // bracket opened a 15px lane above the tabs and the edge moved 54 → 69 with
  // the register's contents. The height is stated, and no other rule anywhere
  // may restate it.
  assert.doesNotMatch(bar, /min-height/);
  for (const { name, source } of sheets) {
    for (const [, selector, body] of source.matchAll(/([^{};]*\.scripture-workspace-bar[^{};]*)\{([^}]*)\}/g)) {
      // Only rules whose SUBJECT is the bar itself. A rule that merely scopes
      // itself to the bar sizes something inside it — the failure line's retry
      // button has a 24px target, and the seal baseline is a 1px pseudo-element
      // — and neither has anything to do with the bar's own box.
      const subjectIsFrameRow = selector
        .split(",")
        .map((one) => one.trim().split(/[\s>+~]+/).at(-1) ?? "")
        .some((subject) => subject.startsWith(".scripture-workspace-bar") && !subject.includes("::"));
      if (!subjectIsFrameRow) continue;
      if (body === bar.slice(bar.indexOf("{") + 1)) continue;
      assert.doesNotMatch(
        body,
        /(?:^|[\s;])(?:min-)?height\s*:/,
        `${name} gives a frame row a second height`,
      );
    }
  }

  // The strip's half of the sum is the tab, and the tab reads the token rather
  // than restating 30 — the two cannot drift apart while that holds.
  /* THE TAB NO LONGER FILLS THE ROW · 2026-08-03. It was `var(--register-strip)`
     and reached the top of the strip, which was right while a 24px band stood
     above holding the window. The band is gone and this row IS the window's, so
     a tab may not reach its top edge: the 8px above a tab is the ground the
     system's own buttons sit on, and it is the gap every browser on this
     platform leaves. Stated as a literal because it is no longer a function of
     the row — the row is 40 and the tab is 32, and the difference is the point. */
  assert.match(styles, /\.scripture-workspace-tab \{[\s\S]{0,900}height: 32px;/);

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

  /* THE ROW IS THE WINDOW'S, AND IT HAS BEEN TWO ROWS AND ONE.
     This first checked that the BAND dragged and that every chip standing in it
     opted back out, because a drag region swallows the press before the element
     under the pointer ever sees it. Both halves were true and the pair was
     still the defect: a 24px region studded with a dozen no-drag boxes is not a
     region, it is the gaps between them, and the maintainer could not grab the
     window at all.

     The chips went into the register, and then the band went with them —
     because once it was empty its only job was to be dragged by, and a drag
     region is not a row. It is a property a row can carry, and the register
     carries it better: the same width, the row a hand is already near, and its
     controls at the two ENDS with most of the window free between them.

     The opt-out claim survives and is stronger for having somewhere real to
     apply: every control in this row opts out, and the free span between them
     is what the window is actually grabbed by. */
  assert.doesNotMatch(styles, /\.scripture-study-chip\b|\.scripture-study-line\b/,
    "the chips and the band are gone from the sheet, not merely unmounted");
  const row = styles.slice(
    styles.indexOf(".scripture-workspace-bar {"),
    styles.indexOf("}", styles.indexOf(".scripture-workspace-bar {")),
  );
  assert.match(row, /-webkit-app-region: drag;/);
  assert.match(styles, /\.scripture-workspace-bar button,\s*\.scripture-workspace-bar input,/);
  /* The tooltip primitive's own wrapper had to opt out too, because it is a real
     span between the row and the control inside it and a drag region swallows
     the press at whichever element it reaches first. It is asserted on the study
     control's own anchor, which is where the tooltip actually is. */
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
