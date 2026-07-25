import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

/**
 * A focus ring keyed on `:focus` or `:focus-within` paints for a mouse click,
 * which is a ring the pointer reader never asked for and cannot dismiss by
 * clicking away — it sits there until focus happens to land somewhere else.
 * Rings belong on `:focus-visible`, which asks the browser whether the reader
 * arrived by keyboard.
 *
 * This regresses one selector at a time, which is why the check is a sweep of
 * the whole sheet rather than an assertion about the one control that was
 * reported. Every exception below is a text-entry surface: a field's ring is
 * what tells you where your typing will go, so it must appear on a click, and
 * `:focus-visible` on an input is a real usability regression rather than a
 * fix. A new entry here has to be a text field or it does not belong.
 */
const TEXT_ENTRY_RING_EXCEPTIONS = [
  // The note capture title and body. Both are the field itself.
  ".note-capture-title-input:focus",
  ".note-capture-textarea:focus",
  // The workspace search field. `:focus-within` because the ring is drawn on
  // the frame around the input rather than on the input.
  ".scripture-workspace-search:focus-within",
];

const isRingPaint = (declarations: string): boolean => {
  const value = (property: string): string | null => {
    const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(declarations);
    return match ? match[1].trim() : null;
  };
  const paints = (raw: string | null): boolean =>
    raw != null && raw !== "none" && raw !== "0" && raw !== "0px";
  return paints(value("outline")) || paints(value("box-shadow"));
};

test("focus rings are keyed on :focus-visible, so a mouse click never leaves one behind", () => {
  const css = read("src/renderer/styles.css");
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const offenders: string[] = [];

  for (const rule of rules) {
    const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
    if (!selector || selector.startsWith("@") || selector.startsWith(":root")) continue;
    // `:focus-visible` is the correct key; everything else that matches focus
    // does so without asking how the reader got there.
    if (!/:focus(?!-visible)/.test(selector)) continue;
    if (!isRingPaint(rule[2])) continue;
    if (TEXT_ENTRY_RING_EXCEPTIONS.some((allowed) => selector.includes(allowed))) continue;
    offenders.push(selector);
  }

  assert.deepEqual(
    offenders,
    [],
    `these rules paint a focus ring without a modality filter, so a mouse click leaves it behind: ${offenders.join(" | ")}`,
  );
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

test("text fields keep their ring on plain :focus, because the ring is the caret's address", () => {
  const css = read("src/renderer/styles.css");

  // Named explicitly so a later sweep for `:focus` does not quietly convert
  // them. A reader who clicks into a field needs to see which field took the
  // click; `:focus-visible` would show nothing until they touched the keyboard.
  assert.match(css, /\.note-capture-title-input:focus\s*\{[^}]*--study-gold-focus/);
  assert.match(css, /\.note-capture-textarea:focus\s*\{[^}]*--study-gold-focus/);
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
