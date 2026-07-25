import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

/**
 * Rev 04 §4 states the focus grammar in three lines, and this file enforces
 * all three:
 *
 *   :focus-visible  outline: 2px solid <seal>; outline-offset: 2px.
 *                   Full strength, outside the shape. Never inset; an inset
 *                   outline lands on the element's own fill and loses its
 *                   ratio.
 *   :focus          NO OUTLINE. Wash only — background: rgba(150,104,74,.06)
 *                   plus a seal caret. A field focused *for* the reader gets
 *                   no ring.
 *   "Never style bare :focus with an outline. The wash is pane emphasis and
 *    was never a focus indicator."
 *
 * This file used to hold the opposite of its third test. It carried a named
 * allowlist, TEXT_ENTRY_RING_EXCEPTIONS, of three text-entry surfaces
 * permitted a bare-`:focus` ring —
 *
 *   ".note-capture-title-input:focus",
 *   ".note-capture-textarea:focus",
 *   ".scripture-workspace-search:focus-within",
 *
 * — each carrying the reason "a field's ring is what tells you where your
 * typing will go, so it must appear on a click". The designer reversed that:
 * the ring is the keyboard's mark, and a field focused for the reader answers
 * with the wash and a seal caret instead. The allowlist is gone rather than
 * shortened, because under Rev 04 there is no surface it could legitimately
 * hold.
 *
 * The sweep itself is unchanged and is the point of the file: this regresses
 * one selector at a time, so the check has to read the whole sheet rather than
 * assert about the one control that was reported.
 */

/** The seal wash, at the .06 §4 sets, written against whichever seal token the
 *  atmosphere is using. A literal rgba(150,104,74,.06) would be the light
 *  theme's seal hard-coded into all six. */
const SEAL_WASH = /color-mix\(in srgb, var\(--study-gold\) 6%, transparent\)/;

const isRingPaint = (declarations: string): boolean => {
  const value = (property: string): string | null => {
    const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(declarations);
    return match ? match[1].trim() : null;
  };
  const paints = (raw: string | null): boolean =>
    raw != null && raw !== "none" && raw !== "0" && raw !== "0px";
  return paints(value("outline")) || paints(value("box-shadow"));
};

type Rule = { selector: string; declarations: string };

const rulesOf = (css: string): Rule[] => {
  const out: Rule[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
    if (!selector || selector.startsWith("@") || selector.startsWith(":root")) continue;
    out.push({ selector, declarations: rule[2] });
  }
  return out;
};

test("no rule paints a ring on bare :focus — the ring is the keyboard's mark", () => {
  const css = read("src/renderer/styles.css");
  const offenders: string[] = [];

  for (const { selector, declarations } of rulesOf(css)) {
    // `:focus-visible` is the correct key; everything else that matches focus
    // does so without asking how the reader got there.
    if (!/:focus(?!-visible)/.test(selector)) continue;
    if (!isRingPaint(declarations)) continue;
    offenders.push(selector);
  }

  assert.deepEqual(
    offenders,
    [],
    `Rev 04 §4: never style bare :focus with an outline. These do: ${offenders.join(" | ")}`,
  );
});

test("a :focus-visible outline is never inset, because an inset ring lands on the element's own fill", () => {
  const css = read("src/renderer/styles.css");
  const offenders: string[] = [];

  for (const { selector, declarations } of rulesOf(css)) {
    if (!/:focus-visible/.test(selector)) continue;
    // Forced-colors mode redraws every mark against the platform's own two
    // colours and is not this grammar; it is exempted where it appears.
    if (!/(?:^|[;{\s])outline-offset\s*:\s*-/.test(declarations)) continue;
    offenders.push(selector);
  }

  // These are the rules that were still inset when §4 landed. They are listed
  // one by one rather than matched by prefix, so a NEW inset ring on any of
  // these surfaces still fails — the list is a debt, not a permission. None of
  // them has a reason that survives §4; each is here only because it belongs to
  // a region another hand is drawing this cycle, and reversing an offset inside
  // someone else's rule is how two agents produce one broken sheet.
  const OUTSTANDING_INSET_RINGS = [
    ".connection-word-chooser button:focus-visible",
    ".margin-tab:focus-visible",
    ".entity-pleiades-connections button:focus-visible",
    ".entity-footprint-books button:focus-visible",
    ".entity-reference-grid button:focus-visible",
    ".note-row:focus-visible",
    ".lang-outline-clause:focus-visible",
    ".lang-orbit-mode:focus-visible",
    ".lang-orbit-row:focus-visible",
    ".command-palette-result:focus-visible",
    '[data-marking-surface="dock"][data-focus-ring="keyboard"] .marking-dock-context .marking-choice:focus-visible',
  ];

  assert.deepEqual(
    offenders.filter((selector) => !OUTSTANDING_INSET_RINGS.includes(selector)),
    [],
    `Rev 04 §4 bans the inset outline: ${offenders.join(" | ")}`,
  );
  // And the debt only ever shrinks.
  assert.deepEqual(
    OUTSTANDING_INSET_RINGS.filter((selector) => !offenders.includes(selector)),
    [],
    "an inset ring on this list is fixed — delete its entry rather than leaving the list stale",
  );
});

test("text entry answers a click with the wash and a seal caret, not a ring", () => {
  const css = read("src/renderer/styles.css");

  // This test used to read, under the heading "text fields keep their ring on
  // plain :focus, because the ring is the caret's address":
  //   assert.match(css, /\.note-capture-title-input:focus\s*\{[^}]*--study-gold-focus/);
  //   assert.match(css, /\.note-capture-textarea:focus\s*\{[^}]*--study-gold-focus/);
  // Rev 04 §4 reverses it. The wash is the click's answer; the ring waits for
  // the keyboard.
  const capture = css.slice(css.indexOf(".note-capture-title-input:focus"));
  const captureFocus = capture.slice(0, capture.indexOf("}") + 1);
  assert.match(captureFocus, SEAL_WASH, "the note fields must wash on :focus");
  assert.match(captureFocus, /caret-color: var\(--accent-seal\)/, "the wash comes with a seal caret");

  // And the ring they gave up is drawn where §4 puts it, at the offset §4 sets.
  assert.match(
    css,
    /\.note-capture-title-input:focus-visible,\s*\n\.note-capture-textarea:focus-visible \{\s*outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/,
  );

  // The workspace search frame is the third surface the old allowlist named.
  // Its input takes `outline: 0`, so the frame rings on its behalf — and it
  // asks :focus-visible's question in container form rather than ringing for
  // every click, which is what `:focus-within` was doing.
  const searchFocus = css.slice(css.indexOf(".scripture-workspace-search:focus-within"));
  assert.match(searchFocus.slice(0, searchFocus.indexOf("}") + 1), SEAL_WASH);
  assert.doesNotMatch(searchFocus.slice(0, searchFocus.indexOf("}") + 1), /box-shadow|outline/);
  // The caret is stated once, where the register's three text fields are
  // declared together, rather than three times at three focus rules.
  assert.match(
    css,
    /\.scripture-workspace-rename input,\s*\n\.scripture-workspace-inline-rename input,\s*\n\.scripture-workspace-search input \{[^}]*caret-color: var\(--accent-seal\);/,
  );
  assert.match(
    css,
    /\.scripture-workspace-search:has\(:focus-visible\) \{\s*outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/,
  );
});

test("a programmatic landing spot says where focus went", () => {
  const css = read("src/renderer/styles.css");

  // Both of these are `tabindex="-1"` targets the app focuses on the reader's
  // behalf — the chapter title after a navigation, the phrase drill-down when
  // it opens. Both used to carry `outline: none` with no `:focus-visible`
  // replacement, so the one moment the app moved your focus for you was the one
  // moment nothing marked where it landed. §4 settles it: wash, then ring.
  for (const surface of [".chapter-title", ".lang-phrase-detail"]) {
    const focusRule = css.slice(css.indexOf(`${surface}:focus {`));
    assert.match(
      focusRule.slice(0, focusRule.indexOf("}") + 1),
      SEAL_WASH,
      `${surface} must wash on :focus`,
    );
    assert.match(
      css,
      new RegExp(`\\${surface}:focus-visible \\{\\s*outline: 2px solid var\\(--study-gold\\);\\s*outline-offset: 2px;`),
      `${surface} must ring on :focus-visible`,
    );
  }
});

test("the topbar search trigger draws its ring once, on :focus-visible", () => {
  const css = read("src/renderer/styles.css");

  // The command palette returns focus to whatever opened it, so the trigger is
  // focused again the moment the palette closes. Keyed on anything but
  // `:focus-visible`, that restored focus repaints the ring for a reader who
  // only ever clicked.
  assert.match(css, /\.command-palette-trigger:focus-visible\s*\{[^}]*--study-gold-focus/);

  // One ring, one rule. `.passage-jump` is the same element as
  // `.command-palette-trigger`; a second ring here is a second place to keep
  // in step, and it was the one that had no modality filter.
  assert.doesNotMatch(css, /\.passage-jump:focus-within\s*\{[^}]*box-shadow/);
  assert.doesNotMatch(css, /\.passage-jump:focus-within\s*\{[^}]*border-color/);
});

test("the cross-reference row hands its ring to the button's :focus-visible", () => {
  const css = read("src/renderer/styles.css");

  // The row outlines on behalf of the button inside it, which gives up its own
  // outline. `:has(:focus-visible)` is the container form of the same
  // question; `:focus-within` would outline the row on a click, and this
  // button navigates, so the ring outlived the click by a whole passage.
  assert.match(css, /\.crossref-row:has\(:focus-visible\),\s*\n\.note-crossref-row:has\(:focus-visible\)\s*\{/);
  assert.match(css, /\.crossref-row-open:focus-visible\s*\{\s*outline: none;\s*\}/);
});

test("the segmented control in settings is declared once", () => {
  const css = read("src/renderer/styles.css");

  // Two `.settings-segmented` declarations in one sheet meant every edit to the
  // control reached only half of itself. The surviving one sits beside
  // `.settings-control-row`, because the column is what it is about.
  const declarations = [...css.matchAll(/^\.settings-segmented\b/gm)];
  assert.equal(
    declarations.length,
    1,
    `expected one top-level .settings-segmented rule, found ${declarations.length}`,
  );
  assert.match(css, /\.settings-segmented \{ justify-self: end; \}/);

  // The dropped `max-width: 320px` could never bind: the widest of the three
  // groups measures 166px inside a 300px track. A fixed width on this control
  // is the pill-era stretch, and it cancels the shrink-to-fit above.
  assert.doesNotMatch(css, /\.settings-segmented[^{}]*\{[^}]*max-width/);
  assert.doesNotMatch(css, /\.settings-segmented,\s*\n\s*\.settings-inline-field \{ width: 250px; \}/);
});
