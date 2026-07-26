import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

/**
 * Rev 05 §05·5 — "one 180ms exchange, and the passage settles rather than the
 * app re-laying out".
 *
 * The exchange between reading and focus moves two of the page's four edges:
 * the left, when the rail leaves the flex flow, and the top, when the register
 * strip unmounts. Before this file both edges snapped, because every element on
 * the path computed the initial `transition: all` — `all` with no duration,
 * which animates nothing.
 *
 * What this file holds is not "the padding has a duration now". It holds the
 * two facts that make the exchange one movement instead of two, and one fact
 * about the fix that was NOT made:
 *
 *   1. The movement names its properties. §9 calls `transition: all` a defect
 *      even where it has a duration, because it animates properties nobody
 *      chose and a declaration added later joins the animation silently.
 *   2. Both halves run on ONE existing token. §9's scale is 120 / 140 / 180 and
 *      no fourth, so the exchange may not invent a duration, and the rail's
 *      band and the page's edges may not run on different ones.
 *   3. It is an animation with a `from`, not a transition. A transition here
 *      starts from the padding the page had before the class landed — 0 — and
 *      the reserve those zeroes were paired with has already gone in the same
 *      frame, so the paper's corner lands on the window's corner and slides 24
 *      back in. That is a bigger step than the one it removes and it puts paper
 *      on the window edge. The `from` says where the rail and the strip left
 *      the page, which is the only thing that makes the walk continuous.
 */

const repoRoot = resolve(import.meta.dirname, "..");
const read = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), "utf-8");

const STYLES = "src/renderer/styles.css";
const RAIL = "src/renderer/styles/rail.css";

/** Every (selector list, body) pair in a sheet, comments stripped from the head. */
function rules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match): [string, string] => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

/** Every declaration block whose selector list is exactly `selector`, in source order. */
function ruleBlocks(css: string, selector: string): string[] {
  const found = rules(css).filter(([head]) => head === selector).map(([, body]) => body);
  assert.notEqual(found.length, 0, `expected a rule for ${selector}`);
  return found;
}

/** A declaration block with its explanatory comments removed. */
const declarations = (body: string): string => body.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The body of one named @keyframes block, braces balanced. */
function keyframes(css: string, name: string): string {
  const from = css.indexOf(`@keyframes ${name}`);
  assert.notEqual(from, -1, `expected @keyframes ${name}`);
  let depth = 0;
  let index = css.indexOf("{", from);
  const start = index;
  for (; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(start + 1, index);
}

test("the focus exchange walks the page's edges on one shared duration token", () => {
  const rail = read(RAIL);
  const css = read(STYLES);

  // The movement itself. Both moving edges are declared in one place, so the
  // left and the top cannot acquire different durations by being edited apart.
  const focusBody = ruleBlocks(rail, ".app-shell.focus-mode .scripture-body");
  const exchange = focusBody[0]!;
  assert.match(exchange, /animation: focus-frame-settle var\(--transition-normal\);/,
    "the exchange must run on the shared 180ms token, never on a bare ms value");

  // §9: "durations 120 / 140 / 180 and no fourth." A number written here is a
  // fourth duration whatever it happens to equal today.
  assert.doesNotMatch(declarations(exchange), /\d+m?s/,
    "the exchange may not write a duration by hand — the tokens exist for this");

  // The same token the rail's own band runs on. §05·5 asks for ONE exchange:
  // the band narrowing and the page settling are halves of one movement, and
  // two durations would make them two events that happen to overlap.
  assert.match(ruleBlocks(css, ".sidebar")[0]!, /transition: width var\(--transition-normal\);/,
    "the band and the page must move on the same token or the exchange is two movements");
  assert.match(css, /--transition-normal: 180ms cubic-bezier\(\.32, \.72, 0, 1\);/,
    "§05·5's 180ms exchange is this token; changing it changes the exchange");

  // NAMED properties, in the keyframe as well as anywhere else. A `from` block
  // is the same hazard `transition: all` is: whatever it lists, it animates.
  const settle = keyframes(rail, "focus-frame-settle");
  const animated = [...settle.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!).sort();
  assert.deepEqual(animated, ["padding-left", "padding-top"],
    "only the two edges that actually move may be animated — nothing may join by accident");

  // And they start at the reserves that vanish in the same frame, named by the
  // tokens that define those reserves. A hand-written 56 is wrong for every
  // reader who has the rail open; a hand-written 54 drifts the moment the
  // register strip's height is edited.
  assert.match(settle, /padding-left: var\(--rail-flow-w\);/,
    "the left edge must start at the width the rail was occupying, not at a literal");
  assert.match(settle, /padding-top: var\(--frame-top\);/,
    "the top edge must start at the strip's own height token");
  assert.doesNotMatch(settle, /\b(?:56|54|232)px\b/,
    "the reserves are tokens; a number here can drift away from the thing it equals");

  // --rail-flow-w is a choice between the rail's two widths, never a third
  // number. This is the token the exchange leans on hardest.
  assert.match(css, /\.app-shell \{\s*--rail-flow-w: var\(--rail-w\);\s*\}/);
  assert.match(css, /\.app-shell:has\(> \.sidebar\.collapsed\) \{\s*--rail-flow-w: var\(--rail-w-collapsed\);\s*\}/);

  // Reduced motion: the mode change still happens, it simply happens at once.
  const reduced = rail.slice(rail.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.notEqual(reduced, "", "the focus exchange must answer prefers-reduced-motion");
  assert.match(reduced, /\.app-shell\.focus-mode \.scripture-body \{\s*animation: none;\s*\}/);

  // And below 979 the rail is a bottom bar: there is no left edge to walk off,
  // so --rail-flow-w describes a column that is not there.
  const narrow = rail.slice(rail.indexOf("@media (max-width: 979px)"));
  assert.match(narrow, /\.app-shell\.focus-mode \.scripture-body \{\s*animation: none;\s*\}/,
    "the narrow shell has no rail column for the page to come off");
});

test("nothing on the focus path carries a bare `transition: all`", () => {
  // §9 counts `all` as a defect even where it has a duration: it animates
  // properties nobody chose, and the next declaration added to the rule joins
  // the animation without anyone deciding that it should.
  //
  // The path is every rule that styles a box the exchange moves or resizes —
  // the shell, the rail, the page column, the page's body, the stage.
  const onPath =
    /(?:^|[\s,>~])\.(?:app-shell|sidebar|main-content|scripture-page|scripture-body|scripture-reading-stage)(?![\w-])/;

  for (const file of [STYLES, RAIL]) {
    for (const [selector, body] of rules(read(file))) {
      if (!onPath.test(selector)) continue;
      assert.doesNotMatch(body, /transition:\s*all\b/,
        `${file}: ${selector} animates every property, chosen or not`);
      assert.doesNotMatch(body, /transition-property:\s*all\b/,
        `${file}: ${selector} animates every property, chosen or not`);
    }
  }
});

test("the page's padding is not transitioned, and the reason is the point", () => {
  // This test used to be unwritable, because the rules it guards had no motion
  // at all: .scripture-body, .scripture-reading-stage and .main-content each
  // computed the initial `transition: all` — `all` with a 0s duration — and the
  // mode change snapped. The obvious repair was to give that shorthand named
  // properties and a duration, and it is the wrong repair.
  //
  // Both paddings are COMPENSATIONS. padding-left 0 → 24 pays back a rail that
  // has just left the flex flow with its 56 (or 232); padding-top 0 → 24 pays
  // back a register strip that has just unmounted with --frame-top's 54. A
  // transition interpolates from the value the element held before the class
  // landed — 0 — by which time the reserve is already gone. Page-left would run
  // 56 → 0 → 24 rather than today's single 56 → 24: a larger step, in the
  // opposite direction, ending with paper laid on the window's own edge.
  //
  // So the padding stays instant in both rules, and the walk is carried by the
  // keyframe's `from` above. Coming back out this is also what keeps the left
  // edge continuous: the rail re-enters the flow at the 24px it is standing at
  // and eases to 56 on its own `transition: width`, while this padding drops to
  // 0 in the same frame. 24 + 0, then 56 + 0 — the sum never jumps.
  const css = read(STYLES);
  const rail = read(RAIL);

  for (const body of ruleBlocks(css, ".scripture-body")) {
    assert.doesNotMatch(body, /transition:[^;]*padding/,
      "a padding transition here eases the compensation while the reserve is already gone");
  }
  for (const body of ruleBlocks(rail, ".app-shell.focus-mode .scripture-body")) {
    assert.doesNotMatch(body, /transition:[^;]*padding/,
      "a padding transition here eases the compensation while the reserve is already gone");
  }
  assert.match(
    ruleBlocks(css, ".scripture-page:not(:has(> .scripture-workspace-bar)) > .scripture-body")[0]!,
    /^\s*padding-top: var\(--page-inset\);\s*$/,
    "the top edge's compensation is instant; the keyframe's `from` does the walking",
  );

  // The two boxes between the shell and the page are deliberately still. Their
  // widths are flex-derived — `flex: 1` with `width: auto` — so there is no
  // specified value for a transition to interpolate, and a declaration here
  // would be inert motion that reads as intent.
  for (const body of ruleBlocks(css, ".main-content")) {
    assert.doesNotMatch(body, /transition|animation/,
      ".main-content's width comes from flex; motion declared here cannot run");
  }
  for (const body of ruleBlocks(css, ".scripture-reading-stage")) {
    assert.doesNotMatch(body, /transition|animation/,
      ".scripture-reading-stage's width comes from flex; motion declared here cannot run");
  }
});
