import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { THEME_OPTIONS } from "../src/renderer/theme.js";

const styles = readFileSync(resolve(import.meta.dirname, "../src/renderer/styles.css"), "utf8");
const component = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScriptureWorkspaceTabs.tsx"),
  "utf8",
);
const workspaceStart = styles.indexOf(".scripture-workspace-bar {");
const workspaceEnd = styles.indexOf(".topbar-navigation,", workspaceStart);
const workspaceStyles = styles.slice(workspaceStart, workspaceEnd);

/** The block of custom properties a single atmosphere selector declares. */
function declaredTokens(selector: string): Map<string, string> {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `styles.css declares no ${selector} block`);
  const body = styles.slice(start, styles.indexOf("\n}", start));
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) declared.set(match[1]!, match[2]!.trim());
  return declared;
}

/**
 * Every at-rule block whose prelude starts with `head`, cut by brace matching
 * rather than by a trailing landmark. A landmark anchor is what let the compact
 * -width scope below run to the end of the sheet once the comment it pointed at
 * was deleted; braces cannot be renamed out from under the test.
 */
function mediaBlocks(head: string): string[] {
  const blocks: string[] = [];
  for (let at = styles.indexOf(head); at !== -1; at = styles.indexOf(head, at)) {
    const open = styles.indexOf("{", at);
    assert.ok(open > at, `${head} at ${at} opens no block`);
    let depth = 0;
    let end = open;
    for (; end < styles.length; end++) {
      if (styles[end] === "{") depth++;
      else if (styles[end] === "}" && --depth === 0) { end++; break; }
    }
    assert.equal(depth, 0, `${head} at ${at} is never closed`);
    blocks.push(styles.slice(at, end));
    at = end;
  }
  return blocks;
}

/** Every flat rule block in the sheet, as [selector, body] pairs. */
function ruleBlocks(): Array<[string, string]> {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

const ATMOSPHERE_SCOPES: Record<string, string> = {
  light: ":root",
  dark: ".dark",
  porcelain: ".theme-porcelain",
  onyx: ".theme-onyx",
};

test("every atmosphere paints the register out of the two planes and nothing else", () => {
  // The register used to derive a bespoke bar fill per theme so it could read as
  // "one continuous chrome" with the toolbar. There is no chrome any more: the
  // strip is the page's own canvas, and the active tab is the page itself. So
  // the only two values either surface may take are the two planes.
  assert.deepEqual(Object.keys(ATMOSPHERE_SCOPES), THEME_OPTIONS.map((option) => option.id));
  for (const [id, scope] of Object.entries(ATMOSPHERE_SCOPES)) {
    const declared = declaredTokens(scope);
    const ground = declared.get("--bg-canvas");
    const paper = declared.get("--bg-reading");
    assert.ok(ground, `${id} must declare the ground`);
    assert.ok(paper, `${id} must declare paper`);
    assert.notEqual(paper, ground, `${id} must keep paper and ground apart`);
  }

  // The strip itself carries no fill. Only the forced-colors fallback may name
  // a surface, and there it must be the system Canvas keyword.
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.scripture-workspace-bar\b/.test(selector)) continue;
    for (const value of [...body.matchAll(/(?:^|[\s;])background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim())) {
      assert.match(value, /^(?:transparent|Canvas)$/, `${selector} gives the register a fill of its own (${value})`);
    }
  }
  assert.match(workspaceStyles, /\.scripture-workspace-bar \{[\s\S]{0,2600}background: transparent;/);
  assert.match(
    workspaceStyles,
    /\.scripture-workspace-tab\[aria-selected="true"\] \{\s*background: var\(--bg-reading\);/,
  );

  // Both vestigial bar tokens are GONE, not merely aliased. They were two of
  // the eight surface fills the design document retires, and they are how the
  // third fill got in last time (#FFF9F0 for Glass, #2D251F for Candlelight).
  // A token nothing reads cannot reintroduce a bespoke literal; a token that
  // still exists as an alias is one careless edit away from doing so.
  assert.equal([...styles.matchAll(/var\(--workspace-(?:bar|active)-bg\)/g)].length, 0,
    "nothing may consume the retired bar fills");
  assert.equal([...styles.matchAll(/--workspace-(?:bar|active)-bg\s*:/g)].length, 0,
    "the retired bar fills must not be declared at all");
});

test("the study control is painted out of the same two planes, and states its own state", () => {
  /* ADDED 2026-07-30 with the study line; RESTATED 2026-08-03 when the studies
     left the drag band for the register's own row. The register's theme rule is
     that a surface may be paper or ground and nothing else, and it reaches both
     halves of this unchanged: the band carries no fill, because it is the page's
     own canvas showing through exactly as the strip beneath it is, and the
     control carries none at rest either.

     What neither may do is answer "which study" with a fill. That is Law 2, and
     it is the same ruling the actions-cluster sweep enforces from the other
     side: the current study is told by ink and weight. */
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.scripture-study-line\b/.test(selector)) continue;
    for (const value of [...body.matchAll(/(?:^|[\s;])background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim())) {
      assert.match(value, /^(?:transparent|Canvas)$/, `${selector} gives the drag band a fill of its own (${value})`);
    }
  }

  const currentRow = /\.scripture-study-row\[aria-checked="true"\] \.scripture-study-row-name \{([^}]*)\}/
    .exec(workspaceStyles);
  assert.ok(currentRow, "the current study must be declared");
  assert.match(currentRow[1]!, /color: var\(--text-primary\);/);
  assert.match(currentRow[1]!, /font-weight: var\(--fw-semibold\);/);
  assert.doesNotMatch(currentRow[1]!, /background/,
    "the current study is ink and weight, never a fill");

  /* THE WIDTH RESERVATION IS RETIRED WITH THE ROW IT PROTECTED. It read

       assert.match(workspaceStyles,
         /\.scripture-study-chip-label::after \{\s*content: attr\(data-label\);\s*font-weight: var\(--fw-semibold\);\s*visibility: hidden;/);

     and it earned its place: a row of chips in which the current one went bold
     shuffled every chip beside it on every switch, so each label reserved its
     own bold form's width in every state. There is no row. The face's weight
     never changes, and in the list the name is a flex child of a full-width row
     with the count pinned to the far end — a row going bold moves nothing, and
     an invisible duplicate of every study's name would now be four hundred bytes
     of DOM defending against a shuffle that cannot happen. */
  assert.doesNotMatch(workspaceStyles, /scripture-study-chip-label/,
    "the reservation went with the chips; nothing here shuffles on a switch");

  /* Forced colours has no hues, so neither ink nor seal survives it and the
     state has to be said in the system's own selection pair — the same answer
     the active tab gives one row down. The band takes the system field so the
     mode reaches it at all, the seal and the tick are redrawn in system ink so
     an authored study still carries a mark, and the row that will take a
     dragged tab keeps its answer to "where will it land", which is the last
     thing a drag can afford to lose. */
  const forced = mediaBlocks("@media (forced-colors: active)")
    .find((block) => block.includes(".scripture-study-row"));
  assert.ok(forced, "forced colours must reach the study control");
    /* The frame's row takes the system's own field. This was on the drag band
     while there was one; the band dissolved into the register on 2026-08-03 and
     the rule followed the region that was its only reason to exist. */
  assert.match(forced, /\.scripture-workspace-bar \{\s*background: Canvas;\s*forced-color-adjust: none;\s*\}/);
  assert.match(forced, /\.scripture-study-row\[aria-checked="true"\] \{ background: Highlight; color: HighlightText; \}/);
  assert.match(forced, /\.scripture-study-seal \{ background: CanvasText; \}/);
  assert.match(forced, /\.scripture-study-row\[data-study-drop-target\] \{\s*background: Highlight;/);
  assert.match(forced, /\.scripture-study-face:focus-visible,/);
  /* A lifted tab loses its shadow here — forced colours drops filters — so the
     outline is what says "held". Without it the one gesture that moves a tab
     between studies has no visible subject in this mode. */
  assert.match(forced, /\.scripture-workspace-tab-wrap\.is-dragging \{ outline: 2px solid Highlight;/);

  // Reduced motion stops the control's own ink transition with everything else.
  assert.match(
    workspaceStyles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.scripture-study-face \{ transition: none; \}/,
  );
  /* THE CHIP ENTRANCE IS RETIRED. `animation: scripture-study-chip-in 150ms
     ease` gave a second study's chip the same entrance a tab makes, so the line
     read as waking up rather than re-laying out. One control does not arrive —
     it is there at one study and at sixteen, and only its count changes — so
     there is nothing left to animate in. */
  assert.doesNotMatch(workspaceStyles, /scripture-study-chip-in/);

  /* And the narrow shell keeps it. The frame's top edge is invariant across
     modes and is composed as --study-line + --register-strip, so hiding the
     band would leave 24px of the page's reserve standing empty and drop the
     rail's brand tile out of alignment with the paper. The control is also the
     only thing at that width that switches studies at all: the rail becomes a
     bottom bar with no switcher in it. */
  for (const block of mediaBlocks("@media (max-width: 979px)")) {
    assert.doesNotMatch(block, /\.scripture-study-control\b[^{}]*\{[^}]*display:\s*none/,
      "a compact-width block hides the study control — it is the only study switcher at that width");
    assert.doesNotMatch(block, /--study-line:|--register-strip:|--frame-top:/,
      "the frame's top edge may not be recomposed at a breakpoint");
  }
});

test("the active tab joins the page with two fillets, not with an underline", () => {
  // Each fillet is an 8x8 block of paper sitting outside the tab at its
  // baseline with the outer top corner carved away by a radial gradient, so the
  // tab's side sweeps into the page's top edge on a continuous curve. They are
  // the tab's own pseudo-elements, so they travel with it on reorder.
  const fillets = /\.scripture-workspace-tab\[aria-selected="true"\]::before,\s*\.scripture-workspace-tab\[aria-selected="true"\]::after \{([\s\S]{0,260}?)\}/.exec(workspaceStyles);
  assert.ok(fillets, "the selected tab must declare both fillets in one rule");
  assert.match(fillets[1]!, /position: absolute;/);
  assert.match(fillets[1]!, /bottom: 0;/);
  assert.match(fillets[1]!, /width: var\(--radius-page\);/);
  assert.match(fillets[1]!, /height: var\(--radius-page\);/);
  assert.match(fillets[1]!, /pointer-events: none;/);

  assert.match(
    workspaceStyles,
    /\.scripture-workspace-tab\[aria-selected="true"\]::before \{\s*left: calc\(-1 \* var\(--radius-page\)\);\s*background: radial-gradient\(\s*circle at 0 0, transparent var\(--radius-page\), var\(--bg-reading\) 0\);\s*\}/,
  );
  assert.match(
    workspaceStyles,
    /\.scripture-workspace-tab\[aria-selected="true"\]::after \{\s*right: calc\(-1 \* var\(--radius-page\)\);\s*background: radial-gradient\(\s*circle at 100% 0, transparent var\(--radius-page\), var\(--bg-reading\) 0\);\s*\}/,
  );
  // Page corner, tab top and fillet are one value. If those three drift the
  // fillet stops being a joint and starts being a smudge.
  //
  // What matters is that all three read the SAME token, which the assertions
  // around this one already hold. The literal was 8px until the frame was
  // re-canonned on 2026-07-29 and it became 14 — at which point pinning the
  // number here turned this into a value-lock on a decision the frame table
  // owns, and it failed for a change that never touched the joint. So the
  // assertion is now the property it was written for: declared once, and a
  // plain length, because the fillet's geometry is computed from it.
  const pageRadius = [...styles.matchAll(/--radius-page:\s*([^;]+);/g)];
  assert.equal(pageRadius.length, 1, "--radius-page is declared once");
  assert.match(pageRadius[0]![1]!.trim(), /^\d+px$/,
    "the fillet is drawn from this length, so it must be a plain px value");
  assert.match(styles, /\.scripture-content \{[\s\S]{0,320}background: var\(--bg-reading\);\s*border-radius: var\(--radius-page\);/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab \{[\s\S]{0,1000}border-radius: var\(--radius-page\) var\(--radius-page\) 0 0;/);
  // Exactly two gradients in the whole register: the pair of fillets.
  assert.equal([...workspaceStyles.matchAll(/radial-gradient/g)].length, 2);
  // And no underline anywhere: the old 2px gold indicator is gone, along with
  // any other bar the selected tab might grow underneath itself.
  assert.doesNotMatch(workspaceStyles, /\[aria-selected="true"\]::after \{[^}]*height: 2px/);
  assert.doesNotMatch(workspaceStyles, /\[aria-selected="true"\]::(?:before|after) \{[^}]*background: var\(--study-gold\)/);

  // When the active tab is FIRST in the register it claims the page's top-left
  // corner outright, so the fillet on that side has nothing to join. The state
  // is a data attribute on the strip, computed from the tab's index.
  //
  // There is deliberately no last-tab counterpart. This test used to assert one
  // in the same breath as the first-tab rule; it is rewritten rather than
  // deleted because flush-END was ruled against, not forgotten. Claiming the
  // top-right corner meant relocating the strip's controls whenever the last
  // tab was selected, and controls that move between selections are a worse
  // experience than a rounded corner is a better one. The last tab therefore
  // keeps its right fillet, and the page keeps its top-right radius, always.
  assert.match(
    workspaceStyles,
    /\.scripture-workspace-bar\[data-flush-start\] \.scripture-workspace-tab\[aria-selected="true"\]::before \{\s*display: none;\s*\}/,
  );
  // The same attribute squares the page's own corner underneath it, so the tab
  // and the page stop being two rounded shapes stacked at the same point.
  assert.match(
    styles,
    /\.scripture-workspace-bar\[data-flush-start\] ~ \.scripture-body \.scripture-content \{\s*border-top-left-radius: 0;\s*\}/,
  );
  assert.doesNotMatch(styles, /\.scripture-content \{\s*border-top-right-radius: 0;/);
  assert.match(component, /const flushStart = activeRegisterIndex === 0/);
  assert.match(component, /data-flush-start=\{flushStart \|\| undefined\}/);
  assert.doesNotMatch(styles, /data-flush-end/);
  assert.doesNotMatch(component, /flushEnd|data-flush-end/);
});

test("workspace labels and controls stay readable without nested alpha masks", () => {
  // The only mask in the block is the clean scroll-edge fade on the viewport;
  // labels and marks never rely on alpha masks.
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-tab-label \{[\s\S]{0,180}mask-image/);
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-tab\.is-scripture::before/);
  assert.doesNotMatch(
    workspaceStyles.slice(
      workspaceStyles.indexOf(".scripture-workspace-actions"),
      workspaceStyles.indexOf(".scripture-workspace-overflow-head"),
    ),
    /linear-gradient/,
  );
  assert.match(workspaceStyles, /font-size: 12px/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-mark \{[\s\S]{0,180}opacity: 1/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-wrap\.is-selected \.scripture-workspace-tab-close \{ opacity: 1; \}/);
  // Scroll-edge indicators are clean mask fades, not blurred inset shadows.
  assert.match(workspaceStyles, /\.scripture-workspace-viewport\.is-scrollable-left\.is-scrollable-right \{[\s\S]{0,220}mask-image: linear-gradient/);
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-viewport\.is-scrollable-left\.is-scrollable-right \{[\s\S]{0,180}box-shadow:/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-close \{[\s\S]{0,180}min-width: 24px;[\s\S]{0,80}min-height: 24px;/);

  // Focus is the solid seal, not its translucent halo: --study-gold-focus is a
  // 34-42% wash that cannot carry a 3:1 ring against paper.
  const focusStart = workspaceStyles.indexOf(".scripture-workspace-tab:focus-visible");
  assert.ok(focusStart > 0, "the register must declare a focus ring");
  const focusRule = workspaceStyles.slice(focusStart, workspaceStyles.indexOf("}", focusStart) + 1);
  assert.match(focusRule, /outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/);
  assert.doesNotMatch(focusRule, /--study-gold-focus/);
  assert.equal([...workspaceStyles.matchAll(/--study-gold-focus/g)].length, 0);
});

test("forced colors, reduced motion, and desktop zoom keep the strip operable", () => {
  assert.match(workspaceStyles, /@media \(forced-colors: active\)[\s\S]*background: Highlight; color: HighlightText/);
  assert.match(workspaceStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  // The register survives on a phone. H makes it the narrow shell's signature —
  // "everything the desktop shell says about hierarchy is said in 24 pixels" —
  // and hiding it deleted the filleted tab, the scrolling strip and the +n
  // count, all of which were already built.
  assert.doesNotMatch(styles, /\.scripture-workspace-bar \{ display: none; \}/);
  // This scope used to end at the comment "/* Do not mistake desktop zoom for a
  // phone.", which was deleted along with the rule it introduced. `indexOf`
  // returned -1, and `slice(start, -1)` runs to the end of the file rather than
  // failing — so the "compact width block" was two thirds of styles.css and
  // this assertion was a copy of the whole-sheet one above it. Brace-match the
  // real blocks instead, state how many there are, and look for a hidden
  // register in any formatting rather than in one exact string.
  // Four since 2026-07-30: the column swap added one of its own rather than
  // reaching into the compact margin split, which is another hand's block this
  // cycle. It holds the folded margin's geometry at compact width and nothing
  // else. The count is stated so that a block appearing without a reason still
  // fails here.
  const compactBlocks = mediaBlocks("@media (max-width: 979px)");
  assert.equal(compactBlocks.length, 4,
    "styles.css declares four max-width:979px blocks — the compact margin split, the "
    + "folded resident, the narrow shell, and the dynamic-type refinement. A different "
    + "count means the narrow shell moved and this scope must be re-anchored before it "
    + "is trusted.");
  for (const block of compactBlocks) {
    assert.doesNotMatch(block, /\.scripture-workspace-bar\b[^{}]*\{[^}]*display:\s*none/,
      "a compact-width block hides the register — H makes it the narrow shell's signature");
  }
});
