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
  assert.match(workspaceStyles, /\.scripture-workspace-bar \{[\s\S]{0,320}background: transparent;/);
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
  assert.match(styles, /--radius-page: 8px;/);
  assert.match(styles, /\.scripture-content \{[\s\S]{0,320}background: var\(--bg-reading\);\s*border-radius: var\(--radius-page\);/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab \{[\s\S]{0,420}border-radius: var\(--radius-page\) var\(--radius-page\) 0 0;/);
  // Exactly two gradients in the whole register: the pair of fillets.
  assert.equal([...workspaceStyles.matchAll(/radial-gradient/g)].length, 2);
  // And no underline anywhere: the old 2px gold indicator is gone, along with
  // any other bar the selected tab might grow underneath itself.
  assert.doesNotMatch(workspaceStyles, /\[aria-selected="true"\]::after \{[^}]*height: 2px/);
  assert.doesNotMatch(workspaceStyles, /\[aria-selected="true"\]::(?:before|after) \{[^}]*background: var\(--study-gold\)/);

  // When the active tab is first or last in the register it claims the page's
  // corner outright, so the fillet on that side has nothing to join. The state
  // is a data attribute on the strip, computed from the tab's index.
  assert.match(
    workspaceStyles,
    /\.scripture-workspace-bar\[data-flush-start\] \.scripture-workspace-tab\[aria-selected="true"\]::before,\s*\.scripture-workspace-bar\[data-flush-end\] \.scripture-workspace-tab\[aria-selected="true"\]::after \{\s*display: none;\s*\}/,
  );
  // Same attribute squares the page's own corner underneath it, so the tab and
  // the page stop being two rounded shapes stacked at the same point.
  assert.match(
    styles,
    /\.scripture-workspace-bar\[data-flush-start\] ~ \.scripture-body \.scripture-content \{\s*border-top-left-radius: 0;\s*\}/,
  );
  assert.match(
    styles,
    /\.scripture-workspace-bar\[data-flush-end\] ~ \.scripture-body \.scripture-content \{\s*border-top-right-radius: 0;\s*\}/,
  );
  assert.match(component, /const flushStart = activeRegisterIndex === 0/);
  assert.match(component, /const flushEnd = activeRegisterIndex >= 0 && activeRegisterIndex === registerTabIds\.length - 1/);
  assert.match(component, /data-flush-start=\{flushStart \|\| undefined\}/);
  assert.match(component, /data-flush-end=\{flushEnd \|\| undefined\}/);
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
  const compactWidthBlock = styles.slice(
    styles.indexOf("@media (max-width: 979px) {"),
    styles.indexOf("/* Do not mistake desktop zoom for a phone."),
  );
  assert.doesNotMatch(compactWidthBlock, /\.scripture-workspace-bar \{ display: none; \}/);
});
