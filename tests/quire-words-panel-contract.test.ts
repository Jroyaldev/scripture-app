import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");
const css = read("src/renderer/styles.css");
const language = read("src/renderer/components/LanguageWordsSection.tsx");
const orbit = read("src/renderer/components/RenderingOrbit.tsx");

/** Every flat rule block in the sheet, as [selector list, body] pairs. */
function ruleBlocks(sheet: string = css): Array<[string, string]> {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

/**
 * True when one of the comma-separated selectors targets `base` itself rather
 * than something inside it — `.lang-orbit` and `.lang-orbit.is-x` do, but
 * `.lang-orbit-row` and `.lang-sense-outline.is-flat .lang-sense-primary-row`
 * do not. The distinction matters because the container is what keeps losing
 * its bareness; its children are allowed their own marks.
 */
function targetsItself(selectorList: string, base: string): boolean {
  const shape = new RegExp(`^${base.replace(/\./g, "\\.")}(\\.[\\w-]+)*(::?[\\w-]+)*$`);
  return selectorList.split(",").some((part) => {
    const last = part.trim().split(/\s+|>/).filter(Boolean).pop() ?? "";
    return shape.test(last);
  });
}

/** Background declarations that actually paint. `none` and `transparent` reset. */
function paintedBackgrounds(body: string): string[] {
  return [...body.matchAll(/background(?:-color|-image)?\s*:\s*([^;]+);/g)]
    .map((match) => match[1]!.trim())
    .filter((value) => !/^(none|transparent|inherit|initial)$/.test(value));
}

/** Border declarations that draw. `0` and `none` reset, they do not paint. */
function drawnBorders(body: string): string[] {
  return [...body.matchAll(/(border(?:-(?:top|bottom|left|right))?)\s*:\s*([^;]+);/g)]
    .filter((match) => !/^(0|none)$/.test(match[2]!.trim()))
    .map((match) => `${match[1]}: ${match[2]!.trim()}`);
}

/**
 * The body of the block whose selector is exactly `selector`. A substring
 * search would find `.lang-orbit-row.is-hover .lang-orbit-label {` when asked
 * for `.lang-orbit-label {`, and then assert about the wrong rule.
 */
function bodyOf(selector: string): string {
  const found = ruleBlocks().filter(([list]) => list === selector);
  assert.equal(found.length, 1, `${selector} must be declared exactly once for this contract to mean anything`);
  return found[0]![1];
}

/** Radii that round. `0` is square. */
function roundedRadii(body: string): string[] {
  return [...body.matchAll(/border-radius\s*:\s*([^;]+);/g)]
    .map((match) => match[1]!.trim())
    .filter((value) => value !== "0");
}

test("the ranked block and the sense list stand on bare paper, in every rule that names them", () => {
  // This is the failure that already happened once. An early rule on
  // `.lang-orbit` removed the fill and said why — a third fill has no room on a
  // paper plane — and a later rule of equal specificity put a card back on both
  // the orbit and the sense outline without ever contradicting the comment.
  // Nothing catches that but a rule that reads the whole sheet, so: no rule
  // anywhere may paint, border or round either container.
  let containerRules = 0;
  for (const [selector, body] of ruleBlocks()) {
    for (const base of [".lang-orbit", ".lang-sense-outline"]) {
      if (!targetsItself(selector, base)) continue;
      containerRules += 1;
      assert.deepEqual(paintedBackgrounds(body), [], `${selector} fills ${base} again`);
      assert.deepEqual(drawnBorders(body), [], `${selector} fences ${base} again`);
      assert.deepEqual(roundedRadii(body), [], `${selector} rounds ${base} into a card again`);
    }
  }
  assert.ok(containerRules >= 2, "the containers lost their rules entirely, so nothing is being guarded");
});

test("the bars keep the argument that beat the donut: a study track and a label that finishes", () => {
  // "Keep the data, change the form." The track is the study rule and it is
  // square — a gold track makes the whole strip read seal, and seal marks the
  // majority bar only.
  assert.match(css, /\.lang-orbit-rule\s*\{[^}]*background: var\(--border-subtle\);/);
  assert.match(css, /\.lang-orbit-rule\s*\{[^}]*border-radius: 0;/);

  // C2·7's stated reason bars beat the donut is that they carry a long label —
  // "deserted place", "on the one hand … but on the other" — which no slice
  // can. Clipping the label to one line throws the argument away.
  const labelBody = bodyOf(".lang-orbit-label");
  assert.match(labelBody, /font-family: var\(--font-reading\)/);
  assert.match(labelBody, /white-space: normal/);
  assert.doesNotMatch(labelBody, /text-overflow|ellipsis/);
  assert.doesNotMatch(labelBody, /overflow: hidden/);

  // A band of tint behind a row is a third fill; the label's ink is the hover.
  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-orbit-row")) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} tints an orbit row`);
  }
  assert.match(css, /\.lang-orbit-row\.is-hover \.lang-orbit-label\s*\{[^}]*color: var\(--text-primary\)/);

  // The donut's own furniture went out with the donut. RenderingOrbit renders a
  // legend, its rows and their rules — nothing else — so a rule for a ring, a
  // hub or a swatch describes a shape that is not on the page.
  for (const dead of [
    ".lang-orbit-svg",
    ".lang-orbit-halo",
    ".lang-orbit-hub",
    ".lang-orbit-seg",
    ".lang-orbit-swatch",
  ]) {
    assert.doesNotMatch(css, new RegExp(dead.replace(/\./g, "\\.")), `${dead} is styling nothing`);
    assert.doesNotMatch(orbit, new RegExp(dead.slice(1)), `${dead} came back into the markup`);
  }

  // The study writes the pair "6 · 67%", not "6× 67%".
  assert.match(orbit, /\{seg\.count\} · \{Math\.round\(seg\.share \* 100\)\}%/);
});

test("the morph line is a sentence about the word, not a row of controls", () => {
  // "Step away": three chips of different shapes read as filter controls but
  // are labels. The drawn form is one line — "Adjective · dative singular
  // feminine" — so the fill, the border and the radius all go, and the dot
  // that separates the parts is type rather than geometry.
  const chipBody = bodyOf(".lang-chip");
  assert.deepEqual(paintedBackgrounds(chipBody), []);
  assert.deepEqual(drawnBorders(chipBody), []);
  assert.deepEqual(roundedRadii(chipBody), []);
  assert.match(css, /\.lang-chip \+ \.lang-chip::before\s*\{[^}]*content: "·";/);

  for (const [selector, body] of ruleBlocks()) {
    if (!/\.lang-chip(?![\w-])|\.lang-chip-(pos|unknown)/.test(selector)) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} fills the morph line again`);
    assert.deepEqual(drawnBorders(body), [], `${selector} boxes the morph line again`);
  }

  // The study never elides the morph line, so there is no "+1" to style and no
  // cap to enforce. A word that would have fitted must not cost a click.
  assert.doesNotMatch(language, /MORPH_CHIP_MAX/);
  assert.doesNotMatch(language, /lang-chip-more/);
  assert.doesNotMatch(css, /\.lang-chip-more/);
});

test("an active word is a seal mark, and a current sense is a seal spine", () => {
  // Root Study A: "2px seal mark … label goes to ink and 600. No background
  // change." Two devices saying "selected" is one device too many, and a tint
  // under a word in the reading face is indistinguishable from a highlight.
  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-word")) continue;
    if (!/\.is-active/.test(selector)) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} fills the active word again`);
  }
  assert.match(css, /\.lang-word\.is-active\s*\{[^}]*box-shadow: inset 0 -2px var\(--study-gold\);/);
  assert.match(css, /\.lang-word\.is-active \.lang-word-form\s*\{[^}]*font-weight: 600;/);

  // The panel's job is to say which sense you are reading. It says it with a
  // mark in the row's reserved left gutter, not by tinting the row.
  assert.match(
    css,
    /\.lang-sense-primary\.is-current\s*\{[^}]*box-shadow: inset 2px 0 0 var\(--accent-seal\);/,
  );
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.lang-sense-primary(-row)?(?![\w-])/.test(selector)) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} tints a sense row`);
  }

  // "Numbered chips lose their colour fill and become hanging figures."
  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-sense-number")) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} refills the sense chip`);
    assert.deepEqual(drawnBorders(body), [], `${selector} redraws the sense chip's box`);
    assert.deepEqual(roundedRadii(body), [], `${selector} re-rounds the sense chip`);
  }
  assert.match(css, /\.lang-sense-number\s*\{[^}]*width: 9px;/);
  assert.match(
    css,
    /\.lang-sense-primary-row\s*\{[^}]*grid-template-columns: 9px minmax\(0, 1fr\) auto;/,
  );
});

test("Structure is a verb in the entry, not a button in the body", () => {
  // "A real destination, wrongly dressed as a button in the body." It is the
  // same kind of verb as Add to note, so it is drawn the same way.
  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-syntax-toggle")) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} refills the Structure verb`);
    assert.deepEqual(drawnBorders(body), [], `${selector} reboxes the Structure verb`);
    assert.deepEqual(roundedRadii(body), [], `${selector} rounds the Structure verb into a button`);
  }
  assert.match(css, /\.lang-syntax-toggle\s*\{[^}]*font-size: 11\.5px;/);
});

test("the definition keeps its disclosure but stops clipping and stops shouting", () => {
  // Kept: a truncated gloss with a disclosure is the right shape. Changed: the
  // label drops to sentence case on its own line, and the caret becomes a word.
  assert.match(css, /\.lang-def-row\s*\{[^}]*flex-direction: column;/);
  const kickerBody = bodyOf(".lang-def-kicker");
  assert.doesNotMatch(kickerBody, /text-transform|letter-spacing/);
  assert.match(kickerBody, /font-size: 11px;/);

  // G3·05: only quotation is ever clipped. A gloss string is content, and its
  // truncation is done upstream by taking the first sense — never by an
  // ellipsis that hides the fact that something was cut.
  const previewBody = bodyOf(".lang-def-preview");
  assert.match(previewBody, /font-family: var\(--font-reading\)/);
  assert.match(previewBody, /white-space: normal/);
  assert.doesNotMatch(previewBody, /ellipsis|overflow: hidden/);
  assert.match(language, /\{open \? "less" : "more"\}/);
  assert.doesNotMatch(language, /lang-def-caret[\s\S]{0,120}▴/);

  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-def-row")) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} washes the definition row`);
  }
});

test("the word entry's writing verb is a footer verb, at full ink", () => {
  // `.margin-capture-action` holds 0.45 for the rows that genuinely reveal on
  // hover, and that base is correct and pinned elsewhere. This one is always
  // visible, so it must not inherit a reveal's opacity and must not multiply
  // one against another — which is exactly what the 0.68 grouping did.
  assert.match(css, /\.margin-capture-action\s*\{[\s\S]*?opacity: 0\.45/);
  assert.doesNotMatch(css, /\.lang-capture-action,\s*\.ai-insight-actions/);
  assert.match(css, /\.lang-capture-action\s*\{[^}]*opacity: 1;/);
  assert.match(css, /\.lang-capture-action\s*\{[^}]*color: var\(--text-primary\);/);
});

test("counts are the UI sans with tabular figures, and never the instrument voice", () => {
  // C2·6: no mono anywhere on this surface. The moment a parse code appears the
  // entry stops being a page and becomes a database row. A tracked 9px label is
  // the same offence at one remove — it reads as mono without being mono.
  for (const [selector, body] of ruleBlocks()) {
    if (!/\.lang-[\w-]/.test(selector)) continue;
    assert.doesNotMatch(body, /--font-mono/, `${selector} sets word-panel copy in the chrome voice`);
  }
  for (const [selector, body] of ruleBlocks()) {
    if (!targetsItself(selector, ".lang-orbit-mode-meta")) continue;
    assert.doesNotMatch(body, /letter-spacing/, `${selector} tracks a count like a mono kicker`);
    assert.doesNotMatch(body, /font-size: 9px/, `${selector} shrinks a count below reading size`);
  }
  assert.match(css, /\.lang-orbit-mode-meta\s*\{[^}]*font-size: 11px;/);

  // Seal means a human did this. The pointer being somewhere is not authorship.
  assert.match(css, /\.lang-more\s*\{[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(css, /\.lang-more:hover\s*\{\s*color: var\(--text-primary\);\s*\}/);
});

test("the pre-C2 word-entry numbers are gone rather than lying dormant", () => {
  // A 23px / 560 head and an 8px top margin are the numbers this entry had
  // before it was drawn against C2. They are dead under `.living-margin`, which
  // restates both — but they would win anywhere else the entry is mounted, and
  // a rule that is only correct because something else overrides it is a trap.
  assert.doesNotMatch(css, /\.lang-detail-form\s*\{\s*font-size: 23px;/);
  assert.doesNotMatch(css, /\.lang-detail\s*\{\s*margin-top: 8px;\s*padding-top: 15px;\s*\}/);
});
