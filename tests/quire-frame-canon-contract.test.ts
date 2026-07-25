import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf8");

const css = read("src", "renderer", "styles.css");
const canvas = read("src", "renderer", "styles", "canvas.css");

/** Comments blanked, line count preserved: a claim about the cascade is a claim
 *  about declarations, and a rule quoted in prose is not a rule. */
const withoutComments = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** Every leaf rule as the cascade sees it, including rules nested inside a
 *  @media or @container — a query must not be able to hide a declaration from
 *  inspection, because a query is exactly where this geometry would regress.
 *  The selector is trimmed of any statement prelude before it (the sheet opens
 *  with a run of @import lines, which would otherwise ride on :root). */
const cssRules = (text: string): { selector: string; body: string }[] => (
  [...withoutComments(text).matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.replace(/\s+/g, " ").replace(/^.*[;}]/, "").trim(),
    body: match[2]!.trim().replace(/\s+/g, " "),
  }))
);

/** The declarations of one custom property, across both owned sheets, as
 *  [selector, value] pairs. */
const declarationsOf = (property: string): [string, string][] => {
  const out: [string, string][] = [];
  for (const text of [css, canvas]) {
    for (const { selector, body } of cssRules(text)) {
      for (const match of body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, "g"))) {
        out.push([selector, match[1]!.trim()]);
      }
    }
  }
  return out;
};

/** The frame table's own value for a number: the one at the root, stated as a
 *  plain length so it can be read off the sheet rather than inferred. */
const px = (property: string): number => {
  const atRoot = declarationsOf(property).filter(([selector]) => selector === ":root");
  assert.equal(atRoot.length, 1, `${property} is stated at the root in ${atRoot.length} places, and the frame table states each number once`);
  const value = atRoot[0]![1]!;
  const size = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  assert.ok(size, `${property} must be a plain px length so the frame can be read off the sheet (got ${value})`);
  return Number(size[1]);
};

/* ═══════════════════════════════════════════════════════════════════════════
   Rev 05 §05·3 · the frame, stated once · desktop ≥ 1200

     Page top        54     24 canvas + 30 strip. Invariant across modes.
     Page left       80     56 rail + 24 canvas. Also invariant.
     Page right/bot  24     window edge, or the study panel's near edge.
     Study panel    380     its top, right and bottom obey the frame.
     Page padding  40/24    inside the paper.
     Paper max     1428     past it the FRAME grows, not the page.

   "Six numbers, and four of them are 24. Everything in §05·4 is derived from
   this table rather than added to it."

   The rows this file owns are the last three. Page top is composed by the
   register strip (--frame-top) and page left by the rail; both are held by
   their own surfaces' contracts.
   ═══════════════════════════════════════════════════════════════════════ */

test("the frame table states each of its numbers exactly once", () => {
  assert.equal(px("--page-padding-inline"), 40, "page padding, left and right, inside the paper");
  assert.equal(px("--page-padding-block"), 24, "page padding, top and bottom, inside the paper");
  assert.equal(px("--page-max-width"), 1428, "paper max width; past it the frame grows, not the page");
  assert.equal(px("--margin-width"), 380, "the study panel");
  assert.equal(px("--page-inset"), 24, "page right and bottom");

  // §05·4's four, which are derived from the table rather than added to it.
  assert.equal(px("--margin-column"), 320);
  assert.equal(px("--margin-column-min"), 240);
  assert.equal(px("--page-spine"), 56);
  assert.equal(px("--page-spine-min"), 40);
  assert.equal(px("--trailing-air-min"), 40);

  // None of them is reachable from a mode. "Invariant across modes" is the
  // table's own word, and a frame number a mode can rewrite is not a frame
  // number. The one licensed exception is the page's own inline padding: it is
  // 40 at every width the quire draws, and gives way only where 40 cannot be
  // afforded, because §05·4's shrink order ends "the measure is the last thing
  // to yield" and the page's padding is air.
  const licensed = new Map([["--page-padding-inline", ".scripture-content"]]);
  for (const property of [
    "--page-padding-inline", "--page-padding-block", "--page-max-width",
    "--margin-column", "--margin-column-min", "--page-spine", "--page-spine-min",
    "--trailing-air-min",
  ]) {
    const elsewhere = declarationsOf(property).filter(([selector]) => selector !== ":root");
    const allowed = licensed.get(property);
    assert.deepEqual(
      elsewhere.map(([selector]) => selector),
      allowed ? [allowed] : [],
      `${property} is re-stated outside the root; the frame is stated once or not at all`,
    );
    if (!allowed) continue;
    // And the yield yields toward the frame's own number, never past it.
    assert.match(
      elsewhere[0]![1]!,
      /^clamp\(\s*0px,[\s\S]*var\(--page-datum\)\s*\)$/,
      "the page's padding may only fall from the datum toward zero",
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Rev 05 §05·4 · THE MEASURE'S LEFT EDGE IS A CONSTANT

   This is the whole claim of the section and the thing that will silently
   regress, because the fault it fixes is not a wrong number — it is a number
   that was never chosen:

     "The page reserves a margin column, then centres the measure in whatever
      is left. So the measure's position is a residue of two other decisions:
      how wide the margin is, and whether the panel is open... and it moves.
      That is what the eye is objecting to. Not the asymmetry."

   The correction:

     "Margin plus spine plus measure is one object, left-anchored at the page's
      40px padding... The measure's left edge becomes a constant:
      40 + 320 + 56 = 416 from the paper's left edge, plus the 32px verse
      gutter that hangs inside it. It does not move when the panel opens, when
      the margin fills, or when the window resizes."

   Two of those three are absolute, and this file holds them absolutely: the
   margin's CONTENTS and the panel's PRESENCE reach no term of the sum. The
   third — window resize — is bounded by §05·4's own shrink order, which names
   what gives and in what order, and by §05·6's single canon switch.
   ═══════════════════════════════════════════════════════════════════════ */

/** The block canon, evaluated the way the grid evaluates it. `paper` is the
 *  page's border box; nothing else about the page is an input, which is the
 *  claim under test. */
const blockCanon = (paper: number, measureBlock = 692) => {
  const pad = 40, m = 320, mMin = 240, s = 56, sMin = 40, tMin = 40;
  const content = paper - pad * 2;
  const clamp = (lo: number, mid: number, hi: number) => Math.min(Math.max(lo, mid), hi);
  const margin = clamp(mMin, content - measureBlock - sMin - tMin, m);
  const spine = clamp(sMin, content - measureBlock - m - tMin, s);
  return {
    margin,
    spine,
    trailingAir: content - margin - spine - measureBlock,
    measureLeft: pad + margin + spine,
    measureWidth: measureBlock,
  };
};

test("the measure's left edge is 416, and is the same number in every state the margin and the panel have", () => {
  // The paper's width is the ONLY input the canon has. So the three states the
  // section names are three paper widths, and at any width the block canon is
  // whole the answer is the same number.
  //
  //   margin open, no panel, 1328px window   paper = 1328 - 80 - 24      = 1224
  //   margin filled to the brim, same window                            = 1224
  //   the study panel open, 1920px window    paper = 1920 - 80 - 24 - 404 = 1412
  //   a 2000px window, panel open            paper capped at             = 1428
  //
  // The margin's contents do not appear because they cannot: the reserve is a
  // grid track, and Law 2 says the space for a mark exists at rest. That is
  // asserted structurally below as well as arithmetically here.
  for (const [label, paper] of [
    ["margin open, no panel, 1328", 1224],
    ["margin occupied to its full 320, no panel, 1328", 1224],
    ["study panel open, 1920", 1412],
    ["study panel open, 2000 — the paper has hit its cap", 1428],
    ["a 1600 window with no panel", 1428],
  ] as const) {
    const canon = blockCanon(paper);
    assert.equal(canon.measureLeft, 416, `${label}: the measure's left edge moved to ${canon.measureLeft}`);
    assert.equal(canon.measureWidth, 692, `${label}: the measure block is 32 gutter + 660 measure`);
    assert.equal(canon.margin, 320, `${label}: the reserve is 320`);
    assert.equal(canon.spine, 56, `${label}: the spine is the datum, and the datum is 56`);
  }

  // 40 + 320 + 56, said once more the way §05·4 says it, so the arithmetic
  // cannot drift from the table above.
  assert.equal(px("--page-padding-inline") + px("--margin-column") + px("--page-spine"), 416);
});

test("the shrink order is the order §05·4 states, and the measure is the last thing to yield", () => {
  // "Trailing air to 40 · spine 56 → 40 · margin 320 → 240 · then the margin
  // CLOSES and its entries move into the study panel as a tab."
  //
  // Read as widths, that is: trailing air is the only thing above the paper
  // width where everything fits; below it the trailing air sits pinned at its
  // floor while the spine gives, then while the margin gives. If any step
  // lets trailing air rise again the order has inverted, which is the one
  // thing the paragraph forbids ("the two outer airs never invert").
  let previousMeasureLeft = Infinity;
  for (let paper = 1092; paper <= 1428; paper += 1) {
    const canon = blockCanon(paper);
    assert.equal(canon.measureWidth, 692, `paper ${paper}: the measure yielded above 980`);
    assert.ok(canon.trailingAir >= 40 - 1e-9, `paper ${paper}: trailing air fell below its 40 floor`);
    assert.ok(canon.trailingAir <= 320 + 1e-9, `paper ${paper}: trailing air passed its 320 ceiling and the outer airs inverted`);
    assert.ok(canon.margin >= 240, `paper ${paper}: the margin shrank past 240 instead of closing`);
    assert.ok(canon.spine >= 40, `paper ${paper}: the spine shrank past 40`);
    // The measure only ever moves outward as the paper grows, and stops at 416.
    assert.ok(
      canon.measureLeft >= previousMeasureLeft || previousMeasureLeft === Infinity,
      `paper ${paper}: the measure's left edge moved backwards while the paper grew`,
    );
    previousMeasureLeft = paper === 1092 ? canon.measureLeft : Math.max(previousMeasureLeft, canon.measureLeft);
    assert.ok(canon.measureLeft <= 416, `paper ${paper}: the measure's left edge passed 416`);
  }
  // Above the width where nothing must give, it is 416 and stays there.
  assert.equal(blockCanon(1188).measureLeft, 416, "1188 is the narrowest paper that owes nothing");
  assert.equal(blockCanon(1187).measureLeft < 416, true, "below it the spine is the first of the two reserves to give");
  // The trailing air is at its floor the whole way through the shrink zone,
  // which is what makes the order visible rather than merely stated.
  for (const paper of [1092, 1120, 1150, 1187]) {
    assert.equal(blockCanon(paper).trailingAir, 40, `paper ${paper}: trailing air is not at its floor while a reserve is giving`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   §05·6 · EXACTLY TWO CANONS AND NEVER A THIRD
   ═══════════════════════════════════════════════════════════════════════ */

test("the page has exactly two canons, one grid declaration, and no in-between position", () => {
  const rules = cssRules(css);

  // One grid declaration. §05·4 prices the whole correction at "one grid
  // declaration"; a second one is a second answer to where the measure goes.
  const gridDeclarations = rules
    .filter(({ selector }) => /\.scripture-inner\b/.test(selector))
    .filter(({ body }) => /(?:^|;)\s*grid-template-columns\s*:/.test(body));
  assert.equal(gridDeclarations.length, 1, "the page's columns are declared once");
  assert.match(gridDeclarations[0]!.selector, /^\.scripture-inner$/);
  assert.match(gridDeclarations[0]!.body, /grid-template-columns: var\(--page-canon\);/);

  // Exactly two canons are defined, and they are the two §05·6 names.
  const canons = [...new Set(declarationsOf("--canon-[a-z]+").map(([, value]) => value))];
  const canonNames = [...new Set(
    [...withoutComments(css).matchAll(/(--canon-[a-z]+)\s*:/g)].map(([, name]) => name!),
  )].sort();
  assert.deepEqual(canonNames, ["--canon-block", "--canon-centred"],
    "block and centred, and never a third");
  assert.equal(canons.length, 2, "each canon is defined once");

  // Both canons are five tracks and put the measure block in the same column,
  // so switching cannot leave the passage half-way between them.
  for (const name of canonNames) {
    const [[, value]] = declarationsOf(name) as [[string, string]];
    assert.match(value, /var\(--measure-block\)/, `${name} does not name the measure block`);
  }

  // Every assignment of the canon resolves to one of the two. This is the "no
  // in-between positions" clause: a rule that computed its own tracks — a
  // margin at 280, a spine at 48 — would be a third canon wearing the name of
  // the switch.
  const assignments = declarationsOf("--page-canon");
  assert.ok(assignments.length >= 2, "the switch has both positions");
  for (const [selector, value] of assignments) {
    assert.match(
      value,
      /^var\(--canon-(?:block|centred)\)$/,
      `${selector} sets the canon to "${value}", which is neither of the two`,
    );
  }

  // The switch reads the PAPER, not the window: a study panel at 380 and a
  // window too narrow for the margin are the same question, and §05·6 answers
  // it once ("so does any window too narrow to hold the margin; so does the
  // page when the study panel is open at this width"). A @media rule here
  // would answer it twice and disagree with itself the moment a panel opened.
  const bare = withoutComments(css);
  const switches = [...bare.matchAll(
    /@container reading-stage \(min-width: (\d+)px\) \{\s*([^{}]+)\{\s*--page-canon: var\(--canon-block\);\s*\}\s*\}/g,
  )];
  assert.equal(
    switches.length,
    assignments.filter(([, value]) => value === "var(--canon-block)").length,
    "every rule that turns the block canon on must do it inside a reading-stage container query",
  );
  // Each threshold is the measure block plus the block canon's own floor —
  // margin 240, spine 40, trailing air 40 — plus the page's 80 of padding.
  const floor = px("--margin-column-min") + px("--page-spine-min") + px("--trailing-air-min") + px("--page-padding-inline") * 2;
  for (const [, width, selector] of switches) {
    const size = /reading-size-([sml])\b/.exec(selector!)?.[1];
    assert.ok(size, `a canon switch at ${width}px is not tied to a shipped measure`);
    const measureBlock = { s: 560, m: 660, l: 780 }[size!]! + 32;
    assert.equal(
      Number(width),
      measureBlock + floor,
      `the ${size} measure's block canon needs ${measureBlock + floor}px of paper, not ${width}`,
    );
  }

  // The residue itself, held down. What stood here was
  //     max-width: calc(measure + gutter + reading gutter * 2);
  //     margin: 0 auto;
  // — a width and a centring, which is how "the measure's position is a
  // residue of two other decisions" was built. Nothing on the page's inline
  // axis but the frame's own padding, so the grid is the only thing that can
  // answer where the measure goes.
  const innerRules = rules.filter(({ selector }) => /^\.scripture-inner$/.test(selector));
  const residue = innerRules
    .flatMap(({ body }) => [...body.matchAll(/(?:^|;)\s*((?:max-|min-)?width|margin(?:-inline|-left|-right)?|justify-(?:content|self)|inset-inline|left|right|translate|transform)\s*:\s*([^;]+)/g)])
    .map(([, property, value]) => `${property}: ${value!.trim()}`);
  assert.deepEqual(residue, [],
    `the page centres itself again outside the grid: ${residue.join("; ")}`);

  // And the passage is placed once, in the column both canons agree on.
  const placement = rules.filter(({ selector }) => selector === ".scripture-inner > *");
  assert.equal(placement.length, 1, "the page's children are placed by one rule");
  assert.match(placement[0]!.body, /grid-column: 4;/,
    "the measure block is column 4 in both canons, so nothing downstream needs to know which is in force");

  // Focus keeps the rectangle and changes only the canon (§05·5), and it must
  // outrank the switch rather than race it.
  const focus = assignments.find(([selector]) => /focus-mode/.test(selector));
  assert.ok(focus, "focus mode does not choose a canon");
  assert.equal(focus![1], "var(--canon-centred)");
  assert.match(focus![0], /^\.app-shell\.focus-mode \.scripture-inner$/,
    "focus must be one class more specific than the switch, or a wide window puts it back into the block canon");
});

test("nothing the margin holds, and nothing the panel does, reaches a term of the measure's left edge", () => {
  // The three terms of 416, plus the measure block itself. A rule conditioned
  // on what the margin CONTAINS, or on whether the study panel is OPEN, may
  // not touch any of them — that is precisely the residue §05·4 removes.
  const terms = /--(?:page-padding-inline|margin-column|page-spine|measure-block|canon-block|canon-centred)\s*:/;
  const conditional = /\.living-margin|\[data-margin|:has\(|\[data-compact|\[data-study|\[data-connection|\.margin-/;

  const offenders: string[] = [];
  for (const text of [css, canvas]) {
    for (const { selector, body } of cssRules(text)) {
      if (!terms.test(body)) continue;
      if (!conditional.test(selector)) continue;
      offenders.push(`${selector} { ${body.slice(0, 140)} }`);
    }
  }
  assert.deepEqual(offenders, [],
    `the measure's left edge is being re-derived from the margin or the panel:\n${offenders.join("\n")}`);

  // And the reserve is a track, not an overlay. §05·4·3 records the rejected
  // option — "drop the reserve and centre the text always" — because "it
  // breaks Law 2: space for a mark exists at rest, so margin material would
  // have to arrive as an overlay and push the text every time you select a
  // verse." A reserve that only exists when it is full is that option.
  const inner = cssRules(css).find(({ selector }) => selector === ".scripture-inner");
  assert.ok(inner, ".scripture-inner is declared");
  const block = declarationsOf("--canon-block")[0]![1]!;
  assert.match(block, /clamp\(\s*var\(--margin-column-min\)/,
    "the margin column is a sized track at rest, not a track that appears when something fills it");
  assert.doesNotMatch(block, /\bauto\b|min-content|max-content|fit-content/,
    "an intrinsic track would size the reserve from what happens to be in it, which is the residue again");
});

/* ═══════════════════════════════════════════════════════════════════════════
   §05·1 / §05·3 · the closed bottom edge, on every paper in the composition
   ═══════════════════════════════════════════════════════════════════════ */

test("the study panel closes its bottom edge the way the page does", () => {
  // §05·1 names it as one of three things that must not be loosened: "the
  // passage scrolls under the leaf inside its own radii... it is the one the
  // study panel is currently breaking." §05·3 says the panel's "own top, right
  // and bottom obey the frame exactly as the page does."
  const page = cssRules(canvas).find(({ selector }) => selector === ".scripture-reading-stage::after");
  const panel = cssRules(canvas).find(({ selector }) => selector === ".scripture-body:has(> .living-margin)::after");
  assert.ok(page, "the page's fade is declared");
  assert.ok(panel, "the study panel has no closed bottom edge");

  for (const [what, rule] of [["page", page!], ["panel", panel!]] as const) {
    assert.match(rule.body, /height: 40px;/, `${what}: 40px of paper-to-transparent`);
    assert.match(rule.body, /border-radius: 0 0 var\(--radius-page\) var\(--radius-page\);/, `${what}: inside its own radii`);
    assert.match(rule.body, /background: linear-gradient\(/, `${what}: paper, not shadow`);
    assert.doesNotMatch(rule.body, /box-shadow|(?<!border-)border(?!-radius)/, `${what}: no shadow and no line`);
  }
  // The panel's fade hangs on the panel's own stage for the reason the page's
  // hangs on the page's: the panel is the scroll container, so anything inside
  // it scrolls away with the entries.
  assert.match(panel!.body, /position: absolute;/);
  assert.match(panel!.body, /right: var\(--page-inset\);/, "the panel's right edge is the frame's 24");
  assert.match(panel!.body, /bottom: var\(--page-inset\);/, "the panel's bottom edge is the frame's 24");
  assert.match(panel!.body, /width: var\(--margin-width\);/, "sized off the frame, not measured");
  assert.match(
    cssRules(css).find(({ selector }) => selector === ".scripture-body")!.body,
    /position: relative;/,
    "the panel's fade needs its stage to be a positioning context",
  );
});

test("the paper's cap grows the frame rather than the page, and holds trailing air under its ceiling", () => {
  // "Paper max width 1428. Past it the frame grows, not the page. A 2000px
  // window gets more canvas and the same leaf."
  const stage = cssRules(css).find(({ selector }) => selector === ".scripture-reading-stage");
  assert.ok(stage, ".scripture-reading-stage is declared");
  assert.match(stage!.body, /max-width: min\( var\(--page-max-width\)/,
    "the paper's cap is the frame table's number");

  // The second term of that min() is what holds §05·4's other bound: trailing
  // air's "ceiling is 320 — the margin's own width... so the two outer airs
  // never invert." At the small measure the paper caps before 1428 and the
  // ceiling is met exactly; at the shipped one 1428 binds first.
  const capped = (measureBlock: number) => Math.min(1428, measureBlock + 40 * 2 + 320 * 2 + 56);
  for (const measureBlock of [592, 692, 812]) {
    const canon = blockCanon(capped(measureBlock), measureBlock);
    assert.ok(canon.trailingAir <= 320,
      `a ${measureBlock}px measure block leaves ${canon.trailingAir} of trailing air, past the margin's own width`);
    assert.equal(canon.measureLeft, 416,
      `a ${measureBlock}px measure block moves the measure's left edge to ${canon.measureLeft}`);
  }
  assert.equal(capped(692), 1428, "at the shipped measure the table's own number is what binds");
});
