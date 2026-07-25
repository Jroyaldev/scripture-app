/**
 * Quire C·4 — the Overview and Notes tabs.
 *
 * Two findings and one law:
 *
 *   · "Scripture" becomes "Cross-references", and the count states whose they
 *     are. Cross-references are the edition's; a connection is a thing the
 *     reader made. Putting one under the other's name is the same class of
 *     error as unmarked licensed prose.
 *   · Entities came down from 28px to 16px serif in a fixed column, and the
 *     list is never re-ranked: "text order, always — ranking by frequency
 *     would put Paul first in every chapter of Acts and teach the reader
 *     nothing."
 *   · Law 7: "a surface owes five states." Notes' empty is drawn — one
 *     sentence, the verbs as words, and the notes written elsewhere in the
 *     study filling the space the absence left.
 *
 * The parts that regress are the ones somebody restores by hand: the count
 * that grew back to include the app's own inferences, the sort that came back
 * because a list "should" be ranked, and the border that came back onto Add
 * note. Those are held shut first.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");
const margin = read("src/renderer/components/LivingMargin.tsx");
const css = read("src/renderer/styles.css");

/** Retired copy is quoted in the comments that record why it was retired, so
 *  "this string is gone" has to mean gone from what renders. */
const marginCode = margin
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The body of one CSS rule, by exact selector. */
function rule(selector: string): string {
  const index = css.indexOf(`\n${selector} {`);
  assert.ok(index >= 0, `expected a rule for ${selector}`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const overview = margin.slice(
  margin.indexOf("function IntentOverview"),
  margin.indexOf("export function LivingMargin"),
);

/* --- Cross-references ---------------------------------------------------- */

test("cross-references are named as cross-references and marked as the edition's", () => {
  assert.match(overview, /title="Cross-references"/);
  assert.match(
    overview,
    /count=\{`\$\{crossRefTotal\.toLocaleString\(\)\} · edition`\}/,
    "the count must say whose the cross-references are",
  );
  // "Scripture" said nothing about provenance, and the reader could read it as
  // their own. Neither the old head nor its id may come back.
  assert.doesNotMatch(overview, /intent-scripture-title/);
  assert.doesNotMatch(overview, /<h3[^>]*>Scripture</);
});

test("the section keeps three rows and an All n at every scope", () => {
  // §C4·5: "64 cross-references at chapter scope, 8 at verse scope. Same three
  // rows and an All 64. A section never changes its shape because the scope
  // changed size." The row count is a constant; only the label moves.
  assert.match(overview, /crossRefItems\.slice\(0, 3\)/);
  assert.match(overview, /crossRefItems\.length > 3/);
  assert.match(overview, /`All \$\{crossRefTotal\.toLocaleString\(\)\}`/);
});

test("cross-reference rows use the shared row grammar and restate none of it", () => {
  // C4·2: one object, one drawing. `.study-ref-row*` is c4-foundation's, and
  // the clamp, the fade and the reserved verb slot live only in its rules — a
  // private clamp here is how the app came to have five reference rows.
  assert.match(overview, /className="study-ref-row study-ref-row--compact"/);
  assert.match(overview, /className="study-ref-row-head"/);
  assert.match(overview, /className="study-ref-row-ref"/);
  assert.match(overview, /className="study-ref-row-verbs"/);
  assert.match(overview, /className="study-ref-row-text"/);
  assert.doesNotMatch(overview, /intent-ref-row|intent-ref-preview|intent-ref-title/);
  assert.doesNotMatch(css, /\.intent-ref-[a-z-]*\s*[,{]/);
  // The clamp, the fade and the hover reveal are c4-foundation's. This surface
  // may not grow a second copy of any of them under its own selectors — that
  // is how one object came to have five drawings.
  for (const [selector, body] of css.matchAll(/\n(\.(?:intent|margin-note)-[a-z-]+[^{\n]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(body!, /-webkit-line-clamp|mask-image/, `${selector!.trim()} restates the clamp`);
  }
  assert.doesNotMatch(
    css,
    /\.margin-note-row\s+\.study-ref-row-verbs/,
    "the verb slot's own geometry is c4-foundation's",
  );
});

/* --- People and places --------------------------------------------------- */

test("the entity list never re-ranks", () => {
  // The defect this guards is a sort, anywhere on the path. `refCount` is drawn
  // and must never be ordered on.
  assert.doesNotMatch(overview, /\.sort\(/);
  assert.doesNotMatch(overview, /refCount\s*[-<>]/);
  const tipnr = read("src/core/language/tipnr.ts");
  const forRange = tipnr.slice(
    tipnr.indexOf("entitiesForRange("),
    tipnr.indexOf("resolve(q: NameResolveQuery)"),
  );
  assert.doesNotMatch(forRange, /\.sort\(/, "entitiesForRange must return text order");
});

test("an entity is 16px serif in a fixed column, with the kind and the count on either side", () => {
  assert.match(overview, /className="intent-entity-name"/);
  assert.match(overview, /className="intent-entity-kind"/);
  assert.match(overview, /className="intent-entity-count"/);
  const name = rule(".intent-entity-name");
  assert.match(name, /font-size: 1rem;/, "the name sets at 16px, not 22 and not 28");
  assert.match(name, /font-family: var\(--font-reading\)/);
  assert.match(name, /flex: 0 0 92px/, "the column edge does the aligning");
  assert.match(rule(".intent-entity-count"), /font-variant-numeric: tabular-nums/);
  // The brief went with the size: four names fit in 130px because there is no
  // prose under them, which is also why no laurel mark is owed here.
  assert.doesNotMatch(overview, /entity\.brief/);
});

/* --- Sources ------------------------------------------------------------- */

test("Sources is the research pane's block, last, and names each corpus", () => {
  assert.match(overview, /<MarginSourcesDisclosure sources=\{sources\} \/>/);
  const tail = overview.slice(overview.lastIndexOf("MarginSourcesDisclosure"));
  assert.doesNotMatch(tail, /<section/, "nothing may be drawn after Sources");
  // The same rows the research pane builds, with the same detail words, so a
  // reader who has learned the block on one surface has learned it here.
  assert.match(overview, /detail: "Cross-references"/);
  assert.match(overview, /detail: "Identity"/);
  assert.match(margin, /\{ name: "STEPBible TIPNR", license: "CC BY 4\.0", detail: "Identity" \}/);
});

/* --- Notes · empty ------------------------------------------------------- */

test("the Notes empty state is one sentence, not three", () => {
  assert.match(margin, /You have not written anything on these \$\{word\} verses\./);
  assert.match(margin, /You have not written anything on this verse\./);
  // Retired: the heading that explained the tab to the reader, and the second
  // sentence under it, and the empty view's own third.
  assert.doesNotMatch(marginCode, /Your anchored note and grounded library context/);
  assert.doesNotMatch(marginCode, /Add a note when this passage gives you something/);
  assert.doesNotMatch(marginCode, /Material from My notes/);
  assert.doesNotMatch(marginCode, /Nothing from your notes yet/);
});

test("empty is never blank: the notes written elsewhere fill the space", () => {
  assert.match(margin, /title="Elsewhere in this study"/);
  assert.match(margin, /countIsYours/, "notes you wrote are seal");
  assert.match(margin, /<MarginNoteRows entries=\{shown\}/);
  assert.match(margin, /`All \$\{elsewhere\.length\.toLocaleString\(\)\}`/);
  // The list is the chapter's own notes minus the ones in scope, in text
  // order, with a relative date.
  assert.match(margin, /function studyNoteEntries/);
  assert.match(margin, /function anchorTouches/);
  assert.match(margin, /formatRelativeDay\(entry\.note\.modified\)/);
});

test("Add note lost its border and became a word", () => {
  assert.doesNotMatch(margin, /className="margin-view-action"/);
  assert.doesNotMatch(css, /\.margin-view-action\s*[,{]/);
  assert.match(margin, /className="margin-note-verb"/);
  const verb = rule(".margin-note-verb");
  assert.match(verb, /border: 0;/);
  assert.match(verb, /background: none;/);
  assert.doesNotMatch(verb, /border-radius: 99px|border: 1px/);
  // C4·6: verbs are words in a footer.
  assert.match(margin, /function MarginNoteFooter/);
  assert.match(rule(".margin-note-footer"), /border-top: 1px solid var\(--border-subtle\)/);
});

/* --- Law 7 --------------------------------------------------------------- */

test("Notes owes loading and failed, and draws them in the shipped state grammar", () => {
  const notesPanel = margin.slice(margin.lastIndexOf('id="margin-notes-panel"'));
  assert.match(notesPanel, /<SurfaceState\s+state="loading"/);
  assert.match(notesPanel, /state="failed"/);
  assert.match(notesPanel, /reason="The library could not be read\."/);
  assert.match(notesPanel, /locality="local"/);
  // A failed state that cannot be retried is a message, not a state.
  assert.match(notesPanel, /setDeepNotesAttempt/);
  assert.match(margin, /setDeepNotesFailed\(!result\.ok\)/);
  // ONE loading device, and it is not a spinner: Rev 03b's seal segment.
  assert.doesNotMatch(notesPanel, /ai-insight-spinner/);
  assert.doesNotMatch(overview, /ai-insight-spinner/);
});

/* --- Counts and provenance ----------------------------------------------- */

test("a zero is never seal", () => {
  // Seal is a mark of authorship, and a count of nothing of yours is not
  // authorship. §C4·1 draws the same Notes tab as `Notes 0` faint at verse
  // scope and `Notes 4` seal at chapter scope — "a reader can then see at a
  // glance that they have three connections and no notes here."
  //
  // c4-foundation enforces `provenance === "reader" && value > 0` on the tab
  // row. The section heads must not drift from it, so the guard lives in
  // StudySectionHead rather than in each caller's `length > 0` wrapper.
  assert.match(margin, /const yours = countIsYours && \(countValue \?\? 0\) > 0;/);
  assert.match(margin, /className=\{`intent-section-count\$\{yours \? " is-yours" : ""\}`\}/);

  // Any head claiming seal must hand over the number that claim is checked
  // against — otherwise the guard silently resolves to unmarked, which Law 3
  // reserves for the edition.
  const heads = [...margin.matchAll(/<StudySectionHead\b([\s\S]*?)\/>/g)].map((match) => match[1]!);
  assert.ok(heads.length >= 4, "expected the section heads to be present");
  for (const props of heads) {
    if (!/countIsYours/.test(props)) continue;
    assert.match(props, /countValue=\{/, "a seal count was given no value to check");
  }
});

test("the Notes count is the reader's own notes and nothing else", () => {
  // It used to read `(pinnedNote ? 1 : 0) + pinnedLibraryItemCount`, which put
  // a seal number on the app's threads and claims — C4·6 makes a count seal
  // only when the count is yours.
  assert.match(margin, /const notesCount = notesHere\.length;/);
  assert.doesNotMatch(margin, /notesCount[\s\S]{0,120}pinnedLibraryItemCount/);
});

/* --- The mono sweep ------------------------------------------------------ */

test("no mono survives on the Overview or Notes surfaces", () => {
  // C4·6 restating C2·6. Tabular figures do the aligning the monospace was
  // there to do.
  for (const selector of [
    ".intent-section-count",
    ".intent-entity-kind",
    ".intent-entity-count",
    ".margin-note-when",
    ".deep-note-meta",
    ".margin-tag",
  ]) {
    assert.doesNotMatch(rule(selector), /--font-mono/, `${selector} is still set in mono`);
  }
  assert.doesNotMatch(css, /\.intent-lead-kind\s*[,{]/);
  assert.doesNotMatch(css, /\.intent-entity-line\s+span\s*\{/);
});

test("Law 2: no pill, no tinted chip, no filled row on these surfaces", () => {
  const tag = rule(".margin-tag");
  assert.doesNotMatch(tag, /border-radius: 99px/);
  assert.doesNotMatch(tag, /background:/);
});
