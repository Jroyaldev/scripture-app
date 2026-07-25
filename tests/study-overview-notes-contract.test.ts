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

/**
 * Every region slice in this file goes through here.
 *
 * An anchor that resolves to the wrong occurrence fails exactly like a
 * selector that matches nothing: silently, and in the passing direction. This
 * file has already been caught by it once — a `#B4AEA5` anchor meant for the
 * count's own comment resolved to the atmosphere token block, and the marker
 * guard reported success while reading a different agent's marker.
 *
 * `lastIndexOf` is never used to CHOOSE a region: picking a match by position
 * is not a uniqueness argument, it is the same bet taken from the other end.
 * Where the last of several IS the intent, the count is asserted and the pick
 * is made explicitly, so it reads as a stated fact rather than a coincidence.
 *
 * It is still used twice, and both are scans from an already-fixed point
 * rather than choices between candidates: `lastIndexOf("{...")` finds the last
 * spread inside one button's props, and `lastIndexOf("/*", at)` finds the
 * comment enclosing a located anchor. Neither picks WHICH thing is under
 * inspection. (This sentence exists because the comment above it read "not
 * used anywhere" while the file used it twice — a claim that was true when
 * written and quietly stopped being true, which is the failure this whole
 * file is about.)
 */
function between(source: string, start: string, end: string, label: string): string {
  const starts = source.split(start).length - 1;
  const ends = source.split(end).length - 1;
  assert.equal(starts, 1, `${label}: start anchor ${JSON.stringify(start)} occurs ${starts}×, need exactly 1`);
  assert.equal(ends, 1, `${label}: end anchor ${JSON.stringify(end)} occurs ${ends}×, need exactly 1`);
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(to > from, `${label}: anchors resolve out of order`);
  return source.slice(from, to);
}

/** A region running from a unique anchor to the end of the source. */
function after(source: string, start: string, label: string): string {
  const count = source.split(start).length - 1;
  assert.equal(count, 1, `${label}: anchor ${JSON.stringify(start)} occurs ${count}×, need exactly 1`);
  return source.slice(source.indexOf(start));
}

/** The body of one CSS rule, by exact selector. Asserts the selector heads
 *  exactly one rule — a name declared twice would silently yield the first. */
function rule(selector: string): string {
  const head = `\n${selector} {`;
  const count = css.split(head).length - 1;
  assert.equal(count, 1, `expected exactly one rule for ${selector}, found ${count}`);
  const open = css.indexOf(head) + head.length - 1;
  const close = css.indexOf("}", open);
  assert.ok(close > open, `unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

const overview = between(
  margin,
  "function IntentOverview",
  "export function LivingMargin",
  "IntentOverview",
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
  // Two rules in one sweep, over every selector this surface owns:
  //   · no `mask-image` — the fade is c4-foundation's, and a second copy of it
  //     is how one object came to have five drawings;
  //   · no `-webkit-line-clamp` — it stamps a literal … at the cut, and C4·2
  //     rules the ellipsis character off this surface entirely.
  // NB this loop previously destructured `matchAll`'s result as [selector, body]
  // — which is [fullMatch, group1], so it tested the SELECTOR for a clamp and
  // passed unconditionally. Fixing the offset found a real ellipsis clamp on
  // `.intent-note-lead`. Index deliberately, not positionally.
  const ownedRules = [...css.matchAll(/\n(\.(?:intent|margin-note)-[a-z-]+[^{\n]*)\{([^}]*)\}/g)];
  // A `doesNotMatch` loop over zero rules passes while proving nothing, so the
  // sweep states how much it swept. If this selector ever stops matching, the
  // count fails here rather than the guarantee quietly evaporating.
  assert.ok(ownedRules.length >= 12, `expected to sweep this surface's rules, swept ${ownedRules.length}`);
  for (const [, selector, body] of ownedRules) {
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
  const forRange = between(
    tipnr,
    "entitiesForRange(",
    "resolve(q: NameResolveQuery)",
    "entitiesForRange",
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
  const tail = after(overview, "<MarginSourcesDisclosure", "Sources");
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
  // Three scope states each draw a Notes panel; the pinned one is the third,
  // and it is the one C4·3 draws. That is asserted rather than assumed: a
  // `lastIndexOf` would keep working, on a different panel, if a fourth
  // appeared or the order changed.
  const notesPanels = [...margin.matchAll(/id="margin-notes-panel"/g)].map((m) => m.index!);
  assert.equal(notesPanels.length, 3, "every scope state must draw the Notes tab");
  const notesPanel = margin.slice(notesPanels[2]!);
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

test("a compact row's wording describes its verb rather than naming it", () => {
  // The retired one-button row carried the preview in its accessible NAME,
  // because a single control had nowhere else to put it. A compact row has two
  // verbs and visible sibling text, so the name stays short and true ("Open
  // Acts 11:15–17") and the wording arrives as the control's description. The
  // failure mode this guards is someone "restoring" the old name and thereby
  // saying the verse twice to a linear reader, in a button name with no bound.
  const openLabels = [...margin.matchAll(/aria-label=\{`Open \$\{item\.targetDisplay\}([^`]*)`\}/g)];
  assert.ok(openLabels.length >= 2, `expected the Open labels to be present, found ${openLabels.length}`);
  for (const [, label] of openLabels) {
    assert.doesNotMatch(label!, /item\.preview/, "the preview is back inside a verb's name");
  }
  assert.match(overview, /aria-describedby=\{previewId\}/);
  assert.match(overview, /<p className="study-ref-row-text" id=\{previewId\}>/);
  // Both verbs on the row point at the same description; neither is left mute.
  assert.equal(
    (overview.match(/aria-describedby=\{previewId\}/g) ?? []).length,
    2,
    "Open and Tab must both be described by the row's wording",
  );
  // A row that IS one control is the other case, and it inverts: an aria-label
  // overrides the button's children, so the name must carry what the children
  // would have said — including `MarginEntryWhy`'s sr-only provenance. Law 3
  // reserves unmarked for the edition, in the accessibility tree too.
  assert.match(
    overview,
    /aria-label=\{`Open \$\{item\.targetDisplay\}\. Written by the app\. \$\{item\.reason\}`\}/,
  );
  // Explicit ARIA comes after every spread, so a helper that grows an ARIA prop
  // cannot clobber a name or a description without anyone noticing.
  const spreadButtons = [...overview.matchAll(/<button\b([\s\S]*?)>/g)]
    .map(([, props]) => props!)
    .filter((props) => props.includes("{...") && props.includes("aria-label"));
  assert.ok(
    spreadButtons.length >= 2,
    `expected buttons that both spread and carry ARIA, found ${spreadButtons.length}`,
  );
  for (const props of spreadButtons) {
    assert.ok(
      props.indexOf("aria-label") > props.lastIndexOf("{..."),
      "an ARIA prop is spread-clobberable",
    );
  }
});

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
  const sealHeads = heads.filter((props) => /countIsYours/.test(props));
  // Counted, not just filtered: a `continue` that skips every head would leave
  // the loop below asserting nothing while still reading as a guarantee.
  assert.ok(sealHeads.length >= 4, `expected the seal heads to be present, found ${sealHeads.length}`);
  for (const props of sealHeads) {
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

/* --- The QA tours, which npm test cannot run ------------------------------
   The Electron tours are repaired by source inspection and executed by hand,
   rarely. Two whole classes of defect in them are statically decidable, so
   they are decided here, in the gate that does run: a probe that queries a
   class this surface never renders, and a regex over-escaped for a context it
   is not in. Both failed silently in the tours' own terms — a `querySelector`
   that finds nothing returns a falsy value a probe happily reports, and a
   never-matching regex sits under a loop that never runs.
   ------------------------------------------------------------------------ */

// Every tour that probes this surface, not merely the ones this agent edited.
// `qa-cross-reference-tour` queries `.intent-overview` and the compact row and
// `qa-desktop-reading-control` drives `.margin-note-verb`; scoping the guards
// to the files I happened to touch would have left both unchecked.
const tours = [
  "scripts/qa-living-margin-tour.mjs",
  "scripts/qa-study-overlays-tour.mjs",
  "scripts/qa-cross-reference-tour.mjs",
  "scripts/qa-desktop-reading-control.mjs",
].map((path) => ({ path, source: read(path) }));

/** Class tokens this surface owns. Other agents' selectors are theirs to check. */
const OWNED_CLASS = /^(?:intent-|margin-note|margin-notes|study-ref-row)/;

test("every selector the tours query on this surface is one it renders", () => {
  const rendered = new Set<string>();
  for (const match of margin.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const token of (match[1] ?? match[2] ?? "").split(/[\s${}?:()"'+]+/)) {
      if (token) rendered.add(token.replace(/^\./, ""));
    }
  }
  const queried = new Set<string>();
  for (const { source } of tours) {
    for (const match of source.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      if (OWNED_CLASS.test(match[1]!)) queried.add(match[1]!);
    }
  }
  assert.ok(queried.size >= 12, `expected the tours to probe this surface, found ${queried.size}`);
  for (const token of queried) {
    assert.ok(rendered.has(token), `the tours query .${token}, which LivingMargin never renders`);
  }
});

test("no regex in the tours is escaped for the wrong context", () => {
  // Inside an `evaluate()` template literal `\\s` is correct — the template is
  // parsed once before the page sees it. In an outer-JS assert it means "a
  // literal backslash", and the assertion can never match. Five of mine were
  // wrong this way and every one would have thrown against a correct app.
  // Template literals are stripped first so the legitimate uses are not flagged.
  let checked = 0;
  for (const { path, source } of tours) {
    const outer = source.replace(/`(?:[^`\\]|\\[\s\S])*`/g, "``");
    for (const line of outer.split("\n")) {
      if (!/^\s*assert\./.test(line)) continue;
      checked += 1;
      assert.doesNotMatch(
        line,
        /\/[^/\n]*\\\\[sdwSDWbB.][^/\n]*\//,
        `${path}: regex escaped for a template literal it is not inside — ${line.trim()}`,
      );
    }
  }
  assert.ok(checked >= 20, `expected to check the tours' assertions, checked ${checked}`);
});

test("what the tours reach for beyond a class name still exists", () => {
  // A class-token check cannot see either of these, and both fail in the
  // direction that reads as "the app is fine": a selector that matches nothing
  // makes a `!querySelector(...)` wait succeed instantly, and a row count that
  // silently widens reports a bigger number without failing.

  // 1 · The attribute. Every "loading has finished" wait in the tours is
  //     `.surface-state[data-surface-state="loading"]`. Rename that attribute
  //     and the waits stop waiting — the tour races the panel and fails later,
  //     somewhere unrelated to the cause.
  const marking = read("src/renderer/components/MarkingSurface.tsx");
  assert.match(marking, /data-surface-state=\{state\}/);
  let loadingWaits = 0;
  for (const { path, source } of tours) {
    for (const match of source.matchAll(/\[data-surface-state="([a-z-]+)"\]/g)) {
      loadingWaits += 1;
      assert.match(
        marking,
        new RegExp(`"${match[1]!}"`),
        `${path} waits on a surface state "${match[1]}" that SurfaceStateId does not define`,
      );
    }
  }
  assert.ok(loadingWaits >= 3, `expected the tours to wait on loading, found ${loadingWaits}`);

  // 2 · The structural assumption. `.intent-overview .study-ref-row--compact`
  //     counts cross-references by assuming they are the only compact rows on
  //     the surface. The library leads are `.intent-note-lead` entries, which
  //     is what keeps that true — if a second section ever grew compact rows,
  //     the probe would fold them into the cross-reference count in silence.
  assert.equal(
    (overview.match(/className="study-ref-row-list"/g) ?? []).length,
    1,
    "a second compact-row list on this surface would silently widen the tours' count",
  );
  // Anchored on the section's own labelled id, not on `hasLibraryLead` — the
  // const is declared above the cross-reference rows, so slicing from it
  // swept them back in and the assertion failed for the wrong reason.
  assert.doesNotMatch(
    after(overview, 'aria-labelledby="intent-library-title"', "the library section"),
    /study-ref-row--compact/,
    "the library leads are entries, not compact rows",
  );
});

test("every departure from the drawing is findable by the sweep, not just explained", () => {
  // §9's markers exist so guesses can be collected mechanically — `derived`
  // needs no reply, `guessed` is batched into the next quire, `trigger` is
  // answered the same week. A guess reasoned out in prose and left unmarked is
  // not marked, it is merely explained to whoever happens to read that
  // function, and it never reaches the batch. These are the three places this
  // surface knowingly departs from C·4's drawings or resolves a conflict
  // between two studies; each must carry a marker, not just an argument.
  // Anchors must be unique to the comment being checked. "#B4AEA5" alone is
  // not: the atmosphere tokens name the same colour, with their own marker,
  // and this guard passed on THEIR marker while its own was deleted. An
  // anchor that resolves to the wrong place fails exactly like a selector
  // that matches nothing — silently, and in the passing direction.
  const departures: Array<[string, string]> = [
    // The drawing's count ink is #B4AEA5; the handoff calls it a shipped defect.
    ["the count's ink", "sets #B4AEA5 here"],
    // C·2 gives the dot to the app; C4·3 draws a seal dot for the reader.
    ["the note row's seal dot", "C·2 gave the dot to the app"],
  ];
  for (const [what, anchor] of departures) {
    assert.equal(
      css.split(anchor).length - 1,
      1,
      `the anchor for ${what} is not unique — it could resolve to another rule's comment`,
    );
  }
  // Scoped to the comment the explanation actually lives in, not a window
  // around it. A ±700-character slice passed this test while the marker was
  // deleted, because it reached a neighbouring rule's marker — "found a
  // marker" is not "found THIS one's marker", which is the same defect this
  // whole file keeps circling.
  const enclosingComment = (source: string, anchor: string): string => {
    const at = source.indexOf(anchor);
    assert.ok(at > 0, `expected to find ${JSON.stringify(anchor)}`);
    const open = source.lastIndexOf("/*", at);
    const close = source.indexOf("*/", at);
    assert.ok(open >= 0 && close > open, `${JSON.stringify(anchor)} is not inside a comment`);
    return source.slice(open, close);
  };
  for (const [what, anchor] of departures) {
    assert.match(
      enclosingComment(css, anchor),
      /@quire (derived|guessed|trigger)/,
      `${what} is explained but unmarked — the sweep will never see it`,
    );
  }
  // Notes is drawn empty only, so its full-state head is derived.
  assert.match(
    enclosingComment(margin, "the head this tab wears when it does"),
    /@quire derived/,
    "the Notes full-state head is undrawn and must say so",
  );
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
