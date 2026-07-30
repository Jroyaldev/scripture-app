import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

/**
 * Rev 04 §7, ruling 5·3. We retired flush-END docking in the register, where
 * selecting the last tab moved Open, All-tabs and the group control from one
 * end of the strip to the other. The owner accepted it and generalised it:
 *
 *   "an actions cluster never changes position as a result of a selection."
 *
 * The specific case is closed — see the note in src/renderer/styles/register.css
 * and the contract in study-workspace-tabs-premium-contract.test.ts, which
 * fails the moment a flush-end attribute name appears anywhere. This file is
 * the general form, and it is a sweep because the specific form was found by
 * eye and the next one will not be.
 *
 * The structural shape of the ruling is: a rule keyed on something being
 * selected may position a MARK, and may not position a CONTROL. Law 2 already
 * says state is a mark on a reserved gutter, and a mark is a pseudo-element
 * drawn into space the row always carried — a `::before` that appears at
 * `inset: 9px auto 9px 0` moves nothing, because nothing was ever in flow
 * there. A positional property on a real element is the other thing: it takes
 * something the reader reaches for and puts it somewhere else, and the reader
 * has no way to see why.
 *
 * Five of the seven properties below can only ever move something in flow, so
 * a state-keyed rule may not set them at all, on a mark or otherwise.
 */

const STYLE_FILES = (() => {
  const dir = "src/renderer/styles";
  return [
    "src/renderer/styles.css",
    ...readdirSync(join(repoRoot, dir))
      .filter((name) => name.endsWith(".css"))
      .sort()
      .map((name) => `${dir}/${name}`),
  ];
})();

/** The seven §7 names, plus the longhands `inset` stands in for. */
const POSITIONAL = /(?:^|[;{\s])(order|justify-content|flex-direction|justify-self|position|inset|inset-inline|inset-block|float)\s*:/g;

/** The five that have no "mark" reading: each one relocates a box in flow. */
const FLOW_ONLY = new Set(["order", "justify-content", "flex-direction", "justify-self", "float"]);

/**
 * Every way this sheet says "this one is the selected/current/attended one".
 * Widen it when a new state attribute appears — a state key the sweep does not
 * know about is a hole in the sweep, not a passing test.
 */
const SELECTION_KEY =
  /\[aria-selected\s*=|\[aria-current\s*=|\[aria-pressed\s*=|\[data-selected|\[data-active|\[data-dock-state\s*=|\[data-surface-state\s*=|\[data-connect-state\s*=|\[data-paint-state\s*=|\[data-study-group-active\s*=|\[data-study-drop\s*=|\[data-flush-start|\[data-margin-mode\s*=|\[data-dirty\s*=|\.is-selected\b|\.is-active\b|\.is-focused\b|\.is-attended\b|\.selected\b|\.active\b|:checked/;

const PSEUDO_ELEMENT = /::(before|after|marker|backdrop|placeholder|selection)/;

type Hit = { file: string; selector: string; properties: string[] };

const sweep = (): Hit[] => {
  const hits: Hit[] = [];
  for (const file of STYLE_FILES) {
    const css = read(file);
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      if (!selector || selector.startsWith("@") || selector.startsWith(":root")) continue;
      if (!SELECTION_KEY.test(selector)) continue;
      POSITIONAL.lastIndex = 0;
      const properties = [...new Set([...rule[2].matchAll(POSITIONAL)].map((m) => m[1]))];
      if (properties.length === 0) continue;
      hits.push({ file, selector, properties });
    }
  }
  return hits;
};

/**
 * The one selection-keyed rule that positions a real element, and why it is
 * allowed. Anything added here has to be a case where the reader can see the
 * reason for the move from the move itself.
 */
const ALLOWED_REAL_ELEMENT_MOVES: { selector: string; reason: string }[] = [
  {
    selector: '.palette-scope-tab[aria-selected="true"]',
    reason:
      "The scope tablist shows one word at a time: the unselected tabs are visually " +
      "hidden at `position: absolute` and take no space in either state, so only the " +
      "selected one is ever in flow. Nothing relocates — the label beside the change " +
      "control is simply a different word, which is the one thing the reader did.",
  },
];

test("a selection may position a mark, never a control", () => {
  const offenders = sweep()
    .filter((hit) => !PSEUDO_ELEMENT.test(hit.selector))
    .filter((hit) => !ALLOWED_REAL_ELEMENT_MOVES.some((allowed) => hit.selector === allowed.selector));

  assert.deepEqual(
    offenders.map((hit) => `${hit.file}: ${hit.selector} [${hit.properties.join(", ")}]`),
    [],
    "Rev 04 §7 5·3: an actions cluster never changes position as a result of a selection",
  );
});

test("no selection key reaches order, justify-content, flex-direction, justify-self or float", () => {
  // These five cannot draw a mark. A `::before` at `position: absolute` sits in
  // reserved air; `order: 2` on a selected row reshuffles the row's siblings,
  // and there is no version of that which is a mark.
  const offenders = sweep()
    .map((hit) => ({ ...hit, properties: hit.properties.filter((name) => FLOW_ONLY.has(name)) }))
    .filter((hit) => hit.properties.length > 0);

  assert.deepEqual(
    offenders.map((hit) => `${hit.file}: ${hit.selector} [${hit.properties.join(", ")}]`),
    [],
    "these properties move a box in flow, so a selection may not set them",
  );
});

test("the allowlist stays honest", () => {
  // An entry that no longer matches anything is an entry nobody is reading. It
  // is also how an allowlist quietly becomes permission for a rule that was
  // rewritten into something else.
  const selectors = new Set(sweep().map((hit) => hit.selector));
  for (const allowed of ALLOWED_REAL_ELEMENT_MOVES) {
    assert.ok(
      selectors.has(allowed.selector),
      `${allowed.selector} is allowlisted but no longer positions anything — delete the entry`,
    );
    assert.ok(allowed.reason.length > 40, `${allowed.selector} must carry a reason, not a shrug`);
  }
});

test("the register's actions cluster is held in place by layout, not by a selection rule", () => {
  /* The specific case ruling 5·3 came from: the cluster's position must be a
     property of the BAR, not of which tab is selected. The selected tab's
     fillet margins move tabs inside the scroller and must never reach the
     controls beside it.

     WHICH ELEMENT ABSORBS THE FREE SPACE CHANGED on 2026-07-29; the ruling did
     not. The viewport used to take it (`flex: 1 1 auto`), which was harmless
     while the only thing after it was a toolbar already pinned to the far edge.
     Then the new-tab plus moved in between them, and a viewport claiming the
     whole bar pushed the plus to the far right — the one place a new-tab
     control must not be. So the viewport grows to its tabs now and the plus
     carries the auto margin instead.

     Both are layout; neither is a selection rule. That is the claim, and it is
     asserted as such rather than as one particular flex value. */
  const css = read("src/renderer/styles.css");
  const body = (selector: string): string => {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `missing ${selector}`);
    return css.slice(start, css.indexOf("\n}", start));
  };

  // Shrinks for an overflowing strip; never grows past its tabs.
  assert.match(body(".scripture-workspace-viewport {"), /flex: 0 1 auto;/);
  // The plus's margin box is the strip's row and not a pixel more. This read
  // `0 auto 3px 4px` until 2026-07-30: 28px of control plus 3px of margin is 31
  // inside a 30px content box, and flex-end takes the overflow off the top, so
  // the plus overhung every tab by a pixel into the window's drag band — the
  // one band the register may not draw in.
  //
  // The comment that stood here said "the plus is what holds the toolbar out at
  // the far edge". Measured in a real window on 2026-07-30, it does not: the
  // Tooltip primitive wraps the plus in an inline-flex span sized to its
  // content, so the auto end-margin has no free space to resolve against and
  // comes out zero. The layout is left as it is — the study line rebuilds this
  // band next — but the assertion is stated as what it can actually defend,
  // which is the geometry of the control, not a consequence it does not have.
  const inlineOpen = body(".scripture-workspace-open.is-inline {");
  assert.match(inlineOpen, /margin: 0 auto 2px 4px;/);
  assert.match(inlineOpen, /height: 28px;/);
  const stripRow = Number.parseFloat(/--register-strip:\s*([\d.]+)px;/.exec(css)![1]!);
  assert.equal(28 + 2, stripRow, "the plus's margin box must be the strip's row exactly");
  // And the toolbar still only ever shrinks.
  assert.match(body(".scripture-workspace-actions {"), /flex: 0 1 auto;/);

  // And the register file holds no rule that moves them. The premium contract
  // already bans the flush-end attribute by name; this bans the mechanism.
  const register = read("src/renderer/styles/register.css");
  assert.doesNotMatch(register, /(?:^|[;{\s])(order|justify-content|flex-direction|float)\s*:/);
});
