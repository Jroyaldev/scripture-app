import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

/**
 * Rev 05 §05·3, row one of the frame table.
 *
 *   Page top · 54 · Window top: 24 canvas + 30 strip. Invariant across modes.
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

test("the page's top edge is 54, and it is composed rather than asserted", () => {
  // The number is never written down. It is 24px of canvas — the drag band —
  // over a 30px tab strip, and the sum is what the other two surfaces read.
  const inset = declarationsOf("--page-inset");
  const strip = declarationsOf("--register-strip");
  const frame = declarationsOf("--frame-top");

  assert.equal(inset.length, 1, "--page-inset is declared once");
  assert.equal(strip.length, 1, "--register-strip is declared once");
  assert.equal(frame.length, 1, "--frame-top is declared once");

  assert.equal(inset[0].value, "24px");
  assert.equal(strip[0].value, "30px");
  assert.match(frame[0].value, /^calc\(var\(--page-inset\) \+ var\(--register-strip\)\)$/);

  // And the sum is 54. Written as arithmetic on the two declared values so the
  // test fails when either half moves, rather than when someone edits a comment.
  const px = (value: string): number => Number.parseFloat(value.replace("px", ""));
  assert.equal(px(inset[0].value) + px(strip[0].value), 54);
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
  assert.match(bar, /height: var\(--frame-top\);/);
  assert.match(bar, /padding: var\(--page-inset\) var\(--page-inset\) 0 0;/);
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
      const subjectIsBar = selector
        .split(",")
        .map((one) => one.trim().split(/[\s>+~]+/).at(-1) ?? "")
        .some((subject) => subject.startsWith(".scripture-workspace-bar") && !subject.includes("::"));
      if (!subjectIsBar) continue;
      if (body === bar.slice(bar.indexOf("{") + 1)) continue;
      assert.doesNotMatch(
        body,
        /(?:^|[\s;])(?:min-)?height\s*:/,
        `${name} gives .scripture-workspace-bar a second height`,
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
  assert.match(
    styles,
    /\.scripture-page:not\(:has\(> \.scripture-workspace-bar\)\) > \.scripture-body \{\s*padding-top: var\(--frame-top\);\s*\}/,
    "a mode that drops the register must still reserve the frame's top edge",
  );
});

test("the drag band is 24 and nothing else", () => {
  // §05·2: "The drag band is 24 and nothing else." The two objects that used to
  // be drawn in it — the group's hairline and the study siglum's own row — are
  // retired, and nothing in the register may reserve height above the tab row
  // again. These are the names both devices went by.
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
});

test("no tooltip may open into the band", () => {
  // §05·2's third deletion: "Tooltips open below their control, inside the page,
  // or not at all." The primitive mirrors the frame's top edge, and this is the
  // assertion that keeps the mirror honest — the CSS token is the authority, but
  // a placement rule cannot parse an unregistered custom property at runtime.
  assert.match(tooltip, /const PAGE_TOP_EDGE = 54;/);
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
  assert.deepEqual(tooltipPlacement(102, 132, 40, 140), { top: 54, side: "top" });
  assert.equal(tooltipPlacement(101, 131, 40, 139), null);
});
