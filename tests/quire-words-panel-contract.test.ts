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

test("morphology is spelled out once, at the head, and the duplicate row is gone", () => {
  // SUPERSEDED, C2·7 → C·4 §3·2. C2·7's ruling was that the three chips stop
  // being chips: no fill, no border, no radius, a middle dot for a separator.
  // This file used to assert that shape. C·4 goes further and deletes the row:
  // the chips and `.lang-detail-kind` were both built from
  // `card.morphExplain.parts` and rendered the same words with the same
  // separator, so the entry said "aorist middle indicative" twice before the
  // reader reached the gloss. "Morphology is spelled out once, at the head,
  // and the duplicate chip row goes."
  //
  // What replaces the old assertions: the chip family must be gone from both
  // the markup and the sheet — a rule kept "just in case" is how the duplicate
  // comes back — and the one surviving copy must be the head's kind line.
  assert.doesNotMatch(language, /lang-chip/, "the chip row came back into the word entry");
  assert.doesNotMatch(css, /\.lang-chip/, "the chip row's rules are styling nothing");
  assert.doesNotMatch(language, /lang-form-chips/);
  assert.doesNotMatch(css, /\.lang-form-chips/);

  // Exactly one element carries the spelled-out form, and it is the head's.
  assert.equal(language.match(/lang-detail-kind/g)?.length, 2, "the kind line is drawn in exactly two branches: with the disclosure, and without one when there are no parts to open");
  assert.match(language, /`lang-form-row\$\{open[\s\S]{0,700}margin-entry-kind lang-detail-kind/);

  // Deleting the duplicate must not delete what it opened. The STEP sentences,
  // each part's meaning, and the parse code and lexicon key C2·7 put behind a
  // disclosure all still open — from the surviving line.
  assert.match(language, /aria-expanded=\{open\}/);
  assert.match(language, /lang-step-overlay/);
  assert.match(language, /<strong>lexicon key<\/strong>/);
  assert.match(language, /<strong>code<\/strong>/);

  // The study never elides the morph line, so there is no "+1" to style and no
  // cap to enforce. A word that would have fitted must not cost a click.
  assert.doesNotMatch(language, /MORPH_CHIP_MAX/);

  // C·4 draws the line "Verb · aorist middle indicative, third person
  // singular" and C2·7 draws "Adjective · dative singular feminine". Both come
  // out of one join: the part of speech, then what the form does, then who it
  // is about — so the comma is read off the feature families, never typed into
  // a lookup table of forms.
  assert.match(language, /morphAction/);
  assert.match(language, /morphAgreement/);
  assert.match(language, /\[morphAction\.join\(" "\), morphAgreement\.join\(" "\)\]\.filter\(Boolean\)\.join\(", "\)/);
});

test("the word entry ends in a footer, and both verbs are in it", () => {
  // C·4 §3·3: "Structure and Add to note join the footer where every other
  // destination lives." This finishes what C2·7 asked for and could not have —
  // it wanted a pane footer and none existed, which is why Add to note rode
  // the lemma's baseline and Structure sat mid-entry dressed as a button.
  const footerBody = bodyOf(".lang-footer");
  assert.match(footerBody, /border-top: 1px solid var\(--border-subtle\)/);
  assert.deepEqual(paintedBackgrounds(footerBody), [], "the footer is a rule and a row, not a bar");
  assert.deepEqual(roundedRadii(footerBody), []);

  const footer = language.slice(
    language.indexOf('<div className="lang-footer">'),
    language.indexOf("<StructureModal"),
  );
  assert.ok(footer.length > 0, "the footer disappeared from the word entry");
  assert.match(footer, /lang-capture-action/);
  assert.match(footer, /lang-syntax-toggle/);
  assert.match(footer, /lang-study-verse/);
  // Order is the drawing's: the writing verb, the destination, then the
  // reference closing the row.
  assert.ok(
    footer.indexOf("lang-capture-action") < footer.indexOf("lang-syntax-toggle"),
    "the destination overtook the writing verb",
  );
  assert.ok(
    footer.indexOf("lang-syntax-toggle") < footer.indexOf("lang-study-verse"),
    "the reference no longer closes the footer row",
  );

  // §C4·6 · "Verbs are words in a footer. No bordered buttons, no circular
  // chips." Both verbs, and the reference, at the same test.
  for (const base of [".lang-syntax-toggle", ".lang-capture-action", ".lang-study-verse"]) {
    for (const [selector, body] of ruleBlocks()) {
      if (!targetsItself(selector, base)) continue;
      assert.deepEqual(paintedBackgrounds(body), [], `${selector} fills a footer verb`);
      assert.deepEqual(drawnBorders(body), [], `${selector} boxes a footer verb`);
      assert.deepEqual(roundedRadii(body), [], `${selector} rounds a footer verb into a chip`);
    }
  }

  // The body's Structure block, and the second word that used to sit beside the
  // verb telling the reader what pressing a destination does, are both gone.
  assert.doesNotMatch(language, /lang-syntax-block/);
  assert.doesNotMatch(css, /\.lang-syntax-block/);
  assert.doesNotMatch(language, /lang-syntax-toggle-hint/);
  assert.doesNotMatch(css, /\.lang-syntax-toggle-hint/);

  // The reference is a count-shaped string, so Law 4 applies: tabular figures
  // do the aligning, and the tracking that made it read as a mono kicker goes.
  const verseBody = bodyOf(".lang-study-verse");
  assert.match(verseBody, /font-variant-numeric: tabular-nums/);
  assert.match(verseBody, /letter-spacing: 0;/);
  assert.doesNotMatch(verseBody, /text-transform/);
});

test("the lexicon key is a hover reveal and the frequency line is a sentence", () => {
  // C·4 §3·4 · "G1096 is gone, per C2·6 — on hover for anyone cross-referencing
  // a commentary." The key rides the head's reserved slot, so arriving changes
  // ink and nothing else; nothing below it moves.
  assert.match(language, /className="margin-entry-name-key lang-detail-strong"/);
  const entries = read("src/renderer/styles/margin-entries.css");
  assert.match(entries, /\.margin-entry-name-key\s*\{[^}]*opacity: 0;/);
  assert.match(entries, /\.margin-entry:hover \.margin-entry-name-key,[\s\S]{0,120}opacity: 1;/);

  // C·4 §3·5 · "8 in this chapter · 125 in Acts · 668 in the corpus" — three
  // scales in one line, spelled, with the middle dot as the separator.
  assert.match(language, /in this chapter/);
  assert.match(language, /in the corpus/);
  assert.match(language, /<span className="lang-dot">·<\/span>/);
  assert.doesNotMatch(language, /\d×|×\s*ch\b/);
});

test("the renderings block keeps its bars and its tail names what it counts", () => {
  // C·4 §3·6 · "become 109 · 16%, came to pass 67 · 10%, be 58 · 9%, then
  // 6 more renderings." The pair separator was implemented from C2·7 and is
  // asserted above; what C·4 adds is the tail, which stops being the notation
  // "+6 more" and becomes a phrase that names the thing being counted.
  assert.match(orbit, /remainderNoun: "renderings"/);
  assert.match(orbit, /\{remainder\} more\{model\.remainderNoun \? ` \$\{model\.remainderNoun\}` : ""\}/);
  assert.doesNotMatch(orbit, /\+\{remainder\} more/);
  // It is one of the panel's "there is more of this" lines and sets like the
  // rest of them, rather than shrinking below the rows it summarises.
  assert.match(bodyOf(".lang-orbit-remainder"), /font: 400 11\.5px var\(--font-ui\)/);
  assert.match(bodyOf(".lang-orbit-remainder"), /color: var\(--text-secondary\)/);
});

test("the multi-verse chooser is two words, not two pills", () => {
  // C·4 §3·1 · "Verse chips become two words." What went: a standing label and
  // a row of numerals in radius-999 capsules with a border, a paper fill, a
  // shadow and a seal underline inside the capsule — a bordered button and a
  // circular chip at once, both banned by §C4·6, and two devices saying
  // "selected" where Law 2 allows one.
  const margin = read("src/renderer/components/LivingMargin.tsx");
  assert.doesNotMatch(margin, /words-verse-chip/);
  assert.doesNotMatch(css, /\.words-verse-chip/);
  assert.doesNotMatch(margin, /Words for verse<\/span>/);
  assert.match(margin, /className=\{`words-verse-word\$\{wordsVerse === verse \? " is-showing" : ""\}`\}/);
  assert.match(margin, /Verse \{verse\}/);

  for (const [selector, body] of ruleBlocks()) {
    if (!/\.words-verse-word/.test(selector)) continue;
    assert.deepEqual(paintedBackgrounds(body), [], `${selector} fills a verse switch again`);
    assert.deepEqual(drawnBorders(body), [], `${selector} boxes a verse switch again`);
    assert.deepEqual(roundedRadii(body), [], `${selector} re-rounds a verse switch into a pill`);
  }

  // The grid stays capped at one verse — the designer's own question in the
  // quire's closing section — so the switch is a switch and never a filter that
  // could show both at once.
  assert.match(margin, /role="radiogroup"/);
  // Reserve: switching verses may change ink and weight, never the row's
  // height, or the word grid below it steps.
  assert.match(css, /\.words-verse-switch\s*\{[^}]*min-height: 18px;/);
});

test("disabled is the label without its count, and it is drawn once for everyone", () => {
  // §C4·5 · "Words has nothing to say about a whole chapter. It renders in
  // ink-3 with no count and no underline." §C4·6 makes it a ruling: "Disabled
  // is the label without its count. Ink-3, no rule, no number. No fourth ink
  // was needed."
  const margin = read("src/renderer/components/LivingMargin.tsx");
  assert.match(margin, /const wordsScopeDisabled = !isPinned && !isNear;/);
  assert.match(margin, /tabIsDisabled = \(tab: MarginTab\): boolean => tab === "passage" && wordsScopeDisabled/);
  // No count when disabled — withheld, not zeroed. `Notes 0` is a fact; a
  // Words count at chapter scope is not, so the count is not computed at all.
  assert.match(margin, /const count = disabled \? null : tabCount\(tab\.id\);/);
  assert.match(margin, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(margin, /disabled \? " is-disabled-instrument" : ""/);

  // The treatment is shared, not a one-off on this tab: nothing in the rule
  // knows what a tab is, so any instrument can adopt it.
  const disabledBody = bodyOf(".is-disabled-instrument");
  assert.match(disabledBody, /color: var\(--text-tertiary\)/, "disabled must be ink-3");
  assert.match(disabledBody, /opacity: 1;/, "disabled is an ink, never the on-state photocopied");
  assert.match(disabledBody, /box-shadow: none/, "no rule");
  assert.doesNotMatch(disabledBody, /not-allowed/, "the cursor is a fourth signal the ruling does not ask for");
  assert.doesNotMatch(disabledBody, /pointer-events/, "an instrument a keyboard cannot reach is off, not disabled");
  assert.match(css, /\.is-disabled-instrument:hover\s*\{[^}]*color: var\(--text-tertiary\)/);

  // It has to win over each host's resting and hover ink, and every host writes
  // those at one class of specificity — so it is last in the sheet rather than
  // escalated to a doubled selector.
  const lastRule = ruleBlocks().at(-1)?.[0];
  assert.equal(lastRule, ".is-disabled-instrument:hover", "the disabled treatment stopped being the sheet's last word");
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
