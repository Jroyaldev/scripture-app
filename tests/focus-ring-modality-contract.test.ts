import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

/** Every stylesheet the renderer bundle imports, as [path, source] pairs.
 *  The wash sweep at the foot of this file reads all of them rather than
 *  styles.css alone: six of the forty-six rings it struck were sitting in
 *  `styles/`, and a sweep that reads one sheet only teaches the defect where
 *  to live. */
const stylesheets = (): Array<[string, string]> => [
  ["src/renderer/styles.css", read("src/renderer/styles.css")],
  ...readdirSync(join(repoRoot, "src/renderer/styles"))
    .filter((name) => name.endsWith(".css"))
    .map((name): [string, string] => [
      `src/renderer/styles/${name}`,
      read(`src/renderer/styles/${name}`),
    ]),
];

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
  //
  // The first of the three was `.scripture-workspace-rename input` — the group
  // popover's field — and both that popover and the control that opened it left
  // the strip on 2026-07-30. Renaming a study happens on its own chip in the
  // study line now, in place and at the size the name is read, so
  // `.scripture-study-rename input` takes the slot. Three fields, one
  // declaration, and the claim is unchanged: a text field in the register
  // answers a click with a caret, wherever the field stands.
  assert.match(
    css,
    /\.scripture-study-rename input,\s*\n\.scripture-workspace-inline-rename input,\s*\n\.scripture-workspace-search input \{[^}]*caret-color: var\(--accent-seal\);/,
  );
  assert.match(
    css,
    /\.scripture-workspace-search:has\(:focus-visible\) \{\s*outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/,
  );

  /* AND THE FIELD IS EXCLUDED FROM THE PANEL-WIDE RULE, which is the half of
     this that was only ever true in prose. The reset above is one class and one
     element deep; `.scripture-workspace-overflow-popover input:focus-visible`
     is two and one — so it won the cascade and the field painted BOTH rings,
     concentric, two pixels apart, on every open of All Tabs. The sheet said the
     frame rings on the input's behalf and then ringed the input as well. */
  assert.match(
    css,
    /\.scripture-workspace-overflow-popover input:not\(\[data-study-all-tabs-search\]\):focus-visible,/,
  );
});

test("a focus the reader did not ask for is not a focus they see ringed", () => {
  const css = read("src/renderer/styles.css");
  const popover = read("src/renderer/components/Popover.tsx");

  /* §4's own words, from the search frame's note: "a field focused FOR the
     reader gets no ring, and the overflow popover focuses this field the moment
     it opens". It was written, and then the ring was drawn anyway — on every
     open, including every open by mouse.

     The browser cannot tell the two apart. Per Selectors 4 an element that takes
     keyboard input matches `:focus-visible` WHENEVER it is focused, programmatic
     focus included, and there is no selector for "the reader did this". So the
     panel carries the distinction: `data-focus-arrival` is on it for exactly as
     long as focus is still where the app put it. */
  assert.match(popover, /panel\.setAttribute\("data-focus-arrival", ""\);/);
  assert.ok(
    popover.indexOf('panel.setAttribute("data-focus-arrival"')
      < popover.indexOf('target.focus({ preventScroll: true })'),
    "the marker goes on before the focus it is about, or one frame rings anyway",
  );

  /* FOCUS MOVING TAKES IT OFF — not a press. The first form of this listened
     for every key and every pointer press in the panel, on the reasoning that a
     reader who pressed anything had arrived under their own power. Two of the
     sheet's own controls disproved it: Clear holds the caret in the search field
     on purpose, and typing never moves focus at all, yet both handed a ring to
     the field the reader had never left. `focusin` says the true thing — the
     arrival ends when focus is somewhere other than where the app put it. */
  assert.match(popover, /panel\.addEventListener\("focusin", depart\);/);
  assert.doesNotMatch(popover, /addEventListener\("(?:keydown|pointerdown)", depart/);
  // Attached after the focus call, or the app's own arrival — which dispatches
  // focusin synchronously — would read as the reader's first move and clear the
  // marker in the same tick it was set.
  assert.ok(
    popover.indexOf("target.focus({ preventScroll: true })")
      < popover.indexOf('panel.addEventListener("focusin", depart)'),
    "the listener goes on after the arrival focus, not before it",
  );
  // Focus RETURNING to the same target is still the app's doing: it is how the
  // sheet re-homes the caret when a row the reader closed takes its own focus
  // out of the document with it.
  assert.match(popover, /if \(event\.target === target\) return;/);

  /* And the field's own reset has to hold IN THE FOCUSED STATE.
     `.scripture-workspace-search input` and the app-wide `input:focus-visible`
     tie at one class and one element; source order breaks the tie 13,000 lines
     later, so the field drew its frame's ring and its own, concentric. */
  assert.match(css, /\.scripture-workspace-search input:focus-visible \{\s*outline: 0;\s*\}/);

  /* Stated once over the whole panel rather than repeated on each ringed
     selector: the claim is about the PANEL's state, not about any control in
     it — and the next surface to autofocus something gets this for free rather
     than rediscovering it. */
  assert.match(
    css,
    /\.popover-panel\[data-focus-arrival\] :focus-visible,\s*\n\.popover-panel\[data-focus-arrival\] \.scripture-workspace-search:has\(:focus-visible\) \{\s*outline: none;\s*\}/,
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

/**
 * This test used to read "the cross-reference row hands its ring to the
 * button's `:focus-visible`", and it asserted exactly two selectors:
 *
 *   assert.match(css, /\.crossref-row:has\(:focus-visible\),\s*\n\.note-crossref-row:has\(:focus-visible\)\s*\{/);
 *   assert.match(css, /\.crossref-row-open:focus-visible\s*\{\s*outline: none;\s*\}/);
 *
 * Both named a surface that no longer exists. Quire C·4 deleted
 * `CrossReferenceRow`, `CrossRefsBlock` and `NoteCrossRefsBlock` from
 * LivingMargin.tsx — the block's heading was mono, which §C4·6 strikes, and
 * its row was one of the five reference-row treatments §C4·2 collapses into
 * two — and re-drew the edition's list on the shared compact row. These two
 * assertions were the last thing holding the `.crossref-*` family in the
 * sheet, and neither described anything the app rendered: the test was green
 * while guarding nothing, which is why the rules read as live for a cycle.
 *
 * The requirement MOVED with the markup; it did not lapse. The defect it was
 * written for was live earlier this cycle — a cross-reference row stayed
 * outlined after its button had navigated the reader away, because the ring
 * was on the container via `:focus-within`, which asks no question about how
 * focus arrived. What changed is where the ring lives, because the row grammar
 * §C4·2 landed has two shapes and neither of them hands anything over:
 *
 *   · `.study-ref-row--compact` is a div, and the things that navigate are the
 *     verbs inside it — Open, Tab, Go to. Each verb rings itself, so there is
 *     no handover left to get wrong, and the row's `:focus-within` does what
 *     `:focus-within` is for: revealing the slot it reserved.
 *   · `.margin-connection-row` IS the button. The ring sits on the focusable
 *     element itself, and the block's attend tint answers hover, thread hover
 *     and `aria-current` rather than focus — so attending a connection, which
 *     scrolls the canvas out from under the pointer, leaves nothing outlined
 *     behind the reader.
 *
 * So the general statement is asserted rather than two names: in the row
 * grammar the ring belongs to whatever is focusable, and no row paints one for
 * a child on `:focus-within`. A row that genuinely must ring on a child's
 * behalf asks the modality question in container form — `:has(:focus-visible)`
 * — which is the one thing the retired rule got right and the reason this test
 * was written. Swept rather than listed, and swept across every sheet: the
 * first test above reads `styles.css` alone, so a `:focus-within` ring in
 * `styles/margin-entries.css`, where the sibling row family lives, was
 * unguarded.
 */
test("in the row grammar the ring belongs to the focusable thing, never to the row on :focus-within", () => {
  // The families a row-with-something-to-activate-in-it is spelled in today. A
  // rule belongs to one when any compound in its selector opens with it, which
  // is how `.study-ref-row--compact:focus-within .study-ref-row-verbs` is
  // caught along with the row itself.
  const ROW_FAMILIES = /(?:^|[\s,>+~])\.(?:study-ref-row|margin-connection-row|margin-note-row|margin-entry)[-\w]*/;

  const offenders: string[] = [];
  for (const [path, css] of stylesheets()) {
    for (const { selector, declarations } of rulesOf(css)) {
      if (!ROW_FAMILIES.test(` ${selector}`)) continue;
      if (!/:focus-within/.test(selector)) continue;
      if (!isRingPaint(declarations)) continue;
      offenders.push(`${path} · ${selector}`);
    }
  }

  // No allowlist, for the same reason the wash sweep has none: `:focus-within`
  // matches a pointer as readily as a key, and every one of these rows holds a
  // control that takes the reader somewhere else. There is no row for which
  // "outlined after the click that navigated away" is the right drawing.
  assert.deepEqual(
    offenders,
    [],
    "a row must not ring for a control inside it on `:focus-within` — the ring outlives the click. " +
      `If the row genuinely rings on a child's behalf, ask \`:has(:focus-visible)\`.\n  ${offenders.join("\n  ")}`,
  );

  /** Every rule in any sheet whose selector list contains exactly this one. */
  const rulesFor = (wanted: string): string[] =>
    stylesheets()
      .flatMap(([, css]) => rulesOf(css))
      .filter(({ selector }) => selector.split(",").some((one) => one.trim() === wanted))
      .map(({ declarations }) => declarations);

  // The verb is what navigates, so the verb carries the ring: §4·4's full
  // strength seal, 2px, outside the shape.
  const verb = rulesFor(".study-ref-row-verb:focus-visible");
  assert.ok(verb.length > 0, "the compact row's verb must draw its own ring");
  for (const declarations of verb) {
    assert.match(declarations, /outline: 2px solid var\(--accent-seal\)/);
    assert.match(declarations, /outline-offset: 2px/);
  }

  // And where the row itself is the focusable thing — the compact row may be
  // drawn as a button, and the connection block always is — the ring is on it
  // directly, rather than on anything wrapping it.
  for (const rowIsTheControl of [
    ".study-ref-row--compact:focus-visible",
    ".margin-connection-row:focus-visible",
  ]) {
    const rules = rulesFor(rowIsTheControl);
    assert.ok(rules.length > 0, `${rowIsTheControl} must exist: the row is the control here`);
    for (const declarations of rules) {
      assert.match(
        declarations,
        /outline: 2px solid var\(--accent-seal\)/,
        `${rowIsTheControl} draws the ring for itself, at full strength`,
      );
    }
  }
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

test("the shared field states its focus style once", () => {
  const css = read("src/renderer/styles.css");

  // The third duplicate-declaration defect found in this sheet, after
  // `.settings-segmented` and `.control-segmented`. `.control-input:focus-visible`
  // was declared twice at top level — once beside `.control-input` itself, and
  // again in the "Focus visibility" section with an extra `outline: none` — so
  // the later copy silently won and every edit to the earlier one reached half
  // of itself. They are folded into the one beside `.control-input`, because
  // the field is what the rule is about.
  const declarations = [...css.matchAll(/^\.control-input:focus-visible\b/gm)];
  assert.equal(
    declarations.length,
    1,
    `expected one top-level .control-input:focus-visible rule, found ${declarations.length}`,
  );

  // `outline: none` came from the copy that was deleted and has to survive the
  // fold: without it the global `input:focus-visible` ring stacks on top of the
  // field's own seal border and the control wears two rings at once.
  //
  // Matched line-anchored rather than by `indexOf`, because the sheet also
  // carries `.note-title-input.control-input:focus-visible` — a compound that
  // contains this selector as a substring, and that a loose search reaches
  // first.
  const body = /^\.control-input:focus-visible \{([^}]*)\}/m.exec(css)?.[1];
  assert.ok(body, "the shared field must declare a :focus-visible rule");
  assert.match(body, /outline: none;/, "the field's ring is its border, so the global outline is cancelled");
  assert.match(body, /border-color: var\(--study-gold\);/);

  // And `.control-button:focus-visible` is gone rather than duplicated too. Its
  // §4·4 correction turned out to be byte-for-byte the ring the global
  // `button:focus-visible` rule already draws, and `.control-button` is only
  // ever spelled on a button.
  assert.doesNotMatch(css, /^\.control-button:focus-visible\b/m);
});

/* ---------------------------------------------------------------------------
   §4·4 · the focus wash is not a focus ring
--------------------------------------------------------------------------- */

/** One rule's declarations, comments stripped, as [property, value] pairs. */
const declarationsOf = (body: string): Array<[string, string]> =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(";")
    .map((declaration) => /^\s*([a-z-]+)\s*:\s*([\s\S]+)$/.exec(declaration))
    .filter((match): match is RegExpExecArray => match != null)
    .map((match) => [match[1]!, match[2]!.replace(/\s+/g, " ").trim()]);

/** The wash, in both the spellings it has actually shipped in: the token by
 *  name, and the seal hand-mixed down toward transparent, which is the same
 *  paint with the token stepped around. `.material-switch` was hiding in the
 *  second form and a sweep reading only the first walked past it. */
const IS_WASH =
  /var\(--study-gold-focus\)|color-mix\([^()]*\bvar\(--(?:study-gold|accent-seal)\)[^()]*\btransparent\s*\)/;

/**
 * Ruling 4·4 in the ledger: the build overrode the drawn focus wash and used
 * full-strength seal as an outline, and the designer confirmed the override as
 * the new drawing — "a wash at .4 cannot reach 3:1 and a keyboard user gets
 * nothing."
 *
 * Measured rather than asserted, composited against the plane each ring sits
 * on, `--study-gold-focus` reaches:
 *
 *   paper  #FCFBF8 · 1.60:1     canvas #E9E6E0 · 1.53:1
 *   Clean  #FFFFFF · 1.61:1     Clean canvas   · 1.58:1
 *   Ink    #1D1B18 · 2.27:1     Ink canvas     · 2.28:1
 *
 * Every pair is under Law 6's 3:1 floor for a mark that carries meaning without
 * words, and the worst of them — a settings dialog on the canvas — is 1.53:1,
 * which is a ring the reader cannot find. Forty-six rules drew one — three of
 * them spelling the wash as a hand-mixed seal rather than naming the token,
 * which is the same paint with the token stepped around, and which is why this
 * sweep matches on both spellings. The replacement is `var(--accent-seal)`
 * undiluted, at 4.64:1 on paper.
 *
 * This is a sweep and not a list of the reported controls, for the reason the
 * file's first test gives: the defect regresses one selector at a time.
 */
test("§4·4 · no outline is painted in the focus wash, in any sheet", () => {
  const offenders: string[] = [];

  for (const [path, css] of stylesheets()) {
    for (const { selector, declarations } of rulesOf(css)) {
      for (const [property, value] of declarationsOf(declarations)) {
        if (property !== "outline" && property !== "outline-color") continue;
        if (!IS_WASH.test(value)) continue;
        offenders.push(`${path} · ${selector} { ${property}: ${value} }`);
      }
    }
  }

  // No allowlist, and there is no shape a reason could take: an outline is the
  // ring, so a washed outline is the whole defect with nothing standing behind
  // it. A ring is `var(--accent-seal)`.
  assert.deepEqual(
    offenders,
    [],
    `§4·4: a ring is full-strength seal, never the wash.\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * The wash still has honest work, and it is worth being exact about which,
 * because "delete the token" and "swap every use of it" are both wrong.
 *
 * A ring is the mark a keyboard user is reading to find themselves. A halo
 * sitting outside a full-strength seal border is not that mark — the border is
 * — and a hover tint is not a focus indicator at all. Law 6 sets no floor for
 * a fill that would lose nothing if deleted, and each of these would lose
 * nothing: delete it and the reader still sees exactly where focus is.
 *
 * Every survivor is named with its reason. An unlisted one fails, and a listed
 * one that has been fixed fails too, so the list can only shrink.
 */
const WASH_HALOS_WITH_REASONS: Record<string, string> = {
  ".command-palette-trigger:focus-visible":
    "the mark is `border-color: var(--study-gold)` at full strength; the 2px halo is a glow outside it",
  ".control-input:focus-visible":
    "same shape — the field's own border goes full-strength seal at 4.64:1 and the 3px halo sits outside it",
  ".note-workspace-search .control-input:focus-visible":
    "narrows the halo above from 3px to 2px; the full-strength border it sits outside is unchanged",
  ".note-workspace-field .control-input:focus-visible":
    "the same narrowing, for the note workspace's own field",
  // The Connections tab's attend tint was here, as a wash reading
  // `var(--study-gold-focus)`. Its entry is deleted rather than left stale
  // because the rule no longer takes a wash token at all: it mixes its alpha
  // off `--accent-seal` directly, so it is no longer a survivor of the sweep
  // and cannot be mistaken for one when `--study-gold-focus` is retired.
  ".theme-choice.active":
    "a selected theme is marked by `border-color: var(--study-gold)`; the 1px halo is decoration behind it",
};

test("§4·4 · what is left of the wash is a halo or a tint, and each one says so", () => {
  const found = new Set<string>();
  const offenders: string[] = [];

  for (const [path, css] of stylesheets()) {
    for (const { selector, declarations } of rulesOf(css)) {
      // A box-shadow is a ring when the rule is answering focus, and it is a
      // ring wherever `--study-gold-focus` is spelled by name, because that
      // token has no job outside the focus grammar. A hand-mixed seal on a
      // rule that is not about focus — the wash behind a search hit, a status
      // dot's glow, the checked switch track — is a fill, and Law 6 sets no
      // floor for a fill. Sweeping those too was how the first draft of this
      // test flagged three things that were never rings.
      const answersFocus = /:focus/.test(selector);
      for (const [property, value] of declarationsOf(declarations)) {
        if (property !== "box-shadow") continue;
        if (!IS_WASH.test(value)) continue;
        if (!answersFocus && !value.includes("--study-gold-focus")) continue;
        if (selector in WASH_HALOS_WITH_REASONS) {
          found.add(selector);
          continue;
        }
        offenders.push(`${path} · ${selector} { box-shadow: ${value} }`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "§4·4: a box-shadow ring in the wash is a ring the reader cannot see. If it is " +
      `genuinely a halo behind a full-strength mark, add it above with its reason.\n  ${offenders.join("\n  ")}`,
  );
  assert.deepEqual(
    Object.keys(WASH_HALOS_WITH_REASONS).filter((selector) => !found.has(selector)),
    [],
    "a halo on this list no longer exists — delete its entry rather than leaving the list stale",
  );
});
