import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

test("word maps expose one complete roving-tab and tabpanel path", () => {
  const language = read("src/renderer/components/LanguageWordsSection.tsx");

  assert.match(language, /data-study-surface="word-map"/);
  assert.match(language, /role="tablist" aria-label="Word map" aria-orientation="horizontal"/);
  assert.match(language, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(language, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(language, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowUp"/);
  assert.match(language, /event\.key === "Home"/);
  assert.match(language, /event\.key === "End"/);
  assert.match(language, /role="tabpanel"/);
  assert.match(language, /aria-labelledby=\{`\$\{panelId\}-\$\{mode\}-tab`\}/);
});

test("Structure keeps the reading material through its body portal", () => {
  const structure = read("src/renderer/components/StructureModal.tsx");

  assert.match(structure, /name === "dark" \|\| name\.startsWith\("theme-"\)/);
  assert.match(structure, /new MutationObserver\(sync\)/);
  assert.match(structure, /data-floating-layer="dialog"/);
  assert.match(structure, /Sentence structure/);
  assert.match(structure, /phrase and clause map/);
  assert.match(structure, /MACULA \+ Clear Bible/);
  assert.match(structure, /CC BY 4\.0/);
});

test("capture, highlight, and cross-reference overlays state trust and source clearly", () => {
  const note = read("src/renderer/components/NoteCapture.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const marking = read("src/renderer/components/MarkingSurface.tsx");

  assert.match(note, /Passage note/);
  assert.match(note, /Plain Markdown · saved locally only when you choose/);
  assert.match(note, /draft\.bodyPrefill \? "Excerpt and source included" : "Quote included"/);
  assert.match(note, /window\.api\.library\.createNote/);

  assert.match(marking, /return createPortal\(/);
  assert.match(marking, /data-floating-layer="toolbar"/);
  assert.match(marking, /theme-\$\{theme\}/);

  // These four lines used to assert the cross-reference block's own copy:
  //   /aria-label="Related verses"/, />Related verses<\/h3>/,
  //   /For this verse/, /Across this passage/
  // — the heading and scope line of `CrossRefsBlock`, which the Connections tab
  // rendered. Quire C·4 struck all of it: the tab shows connections now, the
  // heading and its subtitle were set in mono (C4·6 withdraws mono from this
  // surface), and the block itself is deleted. The requirement this test
  // carries is that the list states trust and source, so it is asserted against
  // the live drawing: Overview's own section, whose head names whose the list
  // is, and whose Sources row names OpenBible and its licence.
  assert.match(margin, /title="Cross-references"/);
  assert.match(margin, /count=\{`\$\{crossRefTotal\.toLocaleString\(\)\} · edition`\}/);
  assert.match(margin, /detail: "Cross-references"/);
  assert.match(margin, /name: crossRefs\.attribution\.name,\s*license: crossRefs\.attribution\.license/);
  // And nothing licensed is drawn under the reader's own word. Matched in the
  // forms the copy could only take if it were rendered, so the note recording
  // why it went is not itself a failure.
  assert.doesNotMatch(margin, /aria-label="Related verses"|>Related verses</);
});

test("study surfaces share restrained material styling without malformed blur expressions", () => {
  const css = read("src/renderer/styles.css");

  assert.match(css, /Study overlays — one restrained material and interaction contract/);
  // Glass and Candlelight retired as themes; the material is now one class
  // applied over any of the four appearances, so overlays opt into it once
  // rather than once per glass theme.
  assert.doesNotMatch(css, /\.theme-glass|\.theme-dark-glass/);
  assert.match(css, /\.material-translucent \{[\s\S]{0,400}--material-blur: 26px/);
  // This line was `/\.crossref-row:hover,[\s\S]*background: var\(--study-hover-surface\)/`
  // — the Connections tab's cross-reference row, which Quire C·4 deleted along
  // with `CrossReferenceRow`, `CrossRefsBlock` and `NoteCrossRefsBlock`. It was
  // also the loosest match in this file: `[\s\S]*` reaches the whole sheet, so
  // it only ever proved that the two strings both occurred somewhere. The
  // requirement is that a study list row's hover is the shared token rather
  // than a fill of its own, so it is asserted on a live row, inside that row's
  // own body.
  assert.match(css, /\.note-row:hover \{[^}]*background: var\(--study-hover-surface\)/);
  assert.match(css, /\.note-capture-panel \{[\s\S]*backdrop-filter: blur\(var\(--material-blur\)\)/);
  assert.doesNotMatch(css, /calc\(var\(--material-blur\) \*/);
  // Retired HighlightToolbar vocabulary must not creep back into the stylesheet.
  assert.doesNotMatch(css, /\.hl-toolbar\b/);
  assert.doesNotMatch(css, /\.highlight-palette\b/);
});
