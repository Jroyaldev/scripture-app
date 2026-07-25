import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { formatResearchRef } from "../src/renderer/components/LivingMargin.js";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");
const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf-8");
const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");
const language = readFileSync(join(repoRoot, "src", "renderer", "components", "LanguageWordsSection.tsx"), "utf-8");
const entriesCss = readFileSync(join(repoRoot, "src", "renderer", "styles", "margin-entries.css"), "utf-8");

/** The border declarations in a rule body that actually paint something —
 *  `border: 0` and `border: none` reset, they do not draw. */
function drawnRules(body: string): string[] {
  return [...body.matchAll(/(border(?:-(?:top|bottom|left|right))?)\s*:\s*([^;]+);/g)]
    .filter((match) => !/^(0|none)$/.test(match[2]!.trim()))
    .map((match) => match[1]!);
}

/** Every flat rule block in a sheet, as [selector, body] pairs. */
function ruleBlocks(sheet: string = css): Array<[string, string]> {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

/** A sheet or a source file with its comments removed. Every "this is gone"
 *  assertion runs against this: a comment recording a deletion, or quoting the
 *  line that licensed it, is not the deletion coming back. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

const cssCode = withoutComments(css);
const marginSource = withoutComments(margin);

/** One rule's declarations, by exact selector, comments stripped. */
function ruleBody(selector: string, sheet: string = css): string {
  const found = ruleBlocks(sheet).find(([candidate]) => candidate === selector);
  assert.ok(found, `${selector} has no rule to check`);
  return withoutComments(found[1]);
}

/** Every .tsx under src/renderer, as [path, source] pairs. */
function rendererComponents(): Array<[string, string]> {
  const root = join(repoRoot, "src", "renderer");
  return readdirSync(root, { recursive: true, encoding: "utf-8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => [entry, readFileSync(join(root, entry), "utf-8")] as [string, string]);
}

/**
 * The body of every `.map(…)` call in a source file, sliced on balanced
 * parentheses. A list's rows are drawn inside one of these, so it is the unit
 * "never both variants in one list" is actually about.
 */
function mapCallbacks(source: string): string[] {
  const bodies: string[] = [];
  for (let start = source.indexOf(".map("); start !== -1; start = source.indexOf(".map(", start + 5)) {
    let depth = 0;
    for (let i = start + 4; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(start, i));
          break;
        }
      }
    }
  }
  return bodies;
}

test("the margin is paper across a gutter, not a tool panel bolted to the page's edge", () => {
  // One plane, the page's own radius, and no hairline: 24px of canvas divides
  // two panes better than a border does, which is what killed the border-left.
  assert.match(css, /\.living-margin\s*\{[\s\S]*?background: var\(--bg-reading\);/);
  assert.match(css, /\.living-margin\s*\{[\s\S]*?border-radius: var\(--radius-page\);/);
  // The sticky header and the lens rail scroll content underneath them, so they
  // have to be opaque — but opaque as paper, never as a third tinted band.
  assert.match(css, /\.margin-frame-header\s*\{[\s\S]*?background: var\(--bg-reading\);/);
  assert.match(css, /\.margin-tabs\s*\{[\s\S]*?background: var\(--bg-reading\);/);

  for (const [selector, body] of ruleBlocks()) {
    if (/\.living-margin\b/.test(selector)) {
      assert.doesNotMatch(body, /border-left/, `${selector} reinstates the margin's border-left`);
    }
    // Mono is the chrome voice. The margin is a workbench you read and write
    // in, so nothing inside it is set in the instrument face.
    if (/\.margin-[\w-]/.test(selector)) {
      assert.doesNotMatch(body, /--font-mono/, `${selector} sets margin copy in the chrome voice`);
    }
  }
});

test("margin content is entries — one skeleton, six parts, and no box", () => {
  // A card with nothing in its lower half reads as a loading failure. An entry
  // that simply stops reads as an entry that had nothing more to say, so the
  // shape is a hanging indent: no border, no fill, no radius. A tinted entry
  // background would also be a third plane inside the margin's paper.
  assert.match(entriesCss, /\.margin-entry\s*\{[\s\S]*?padding-left: var\(--margin-entry-hang/);
  assert.match(entriesCss, /\.margin-entry\s*\{[\s\S]*?border: 0;/);
  assert.match(entriesCss, /\.margin-entry\s*\{[\s\S]*?border-radius: 0;/);
  assert.match(entriesCss, /\.margin-entry\s*\{[\s\S]*?background: transparent;/);
  // Separate with interval, not with lines: one reading band between entries.
  assert.match(entriesCss, /\.margin-entry-list > \.margin-entry \+ \.margin-entry\s*\{\s*margin-top: var\(--band\);\s*\}/);

  for (const [selector, body] of ruleBlocks(entriesCss)) {
    // The margin gives up mono entirely — serif for content, Instrument Sans
    // for handles. That contrast is what makes it read as more page.
    if (/\.margin-[\w-]/.test(selector)) {
      assert.doesNotMatch(body, /--font-mono/, `${selector} sets margin copy in the chrome voice`);
    }
    // Nothing moves on hover: space for every reveal exists at rest, so a
    // reveal may change opacity and ink and nothing else.
    if (/:hover|:focus-within/.test(selector)) {
      assert.doesNotMatch(
        body,
        /(^|[;{\s])(transform|translate|width|height|margin|padding|font-size|display|inset|top|left|right|bottom)\s*:/,
        `${selector} moves geometry on hover`,
      );
    }
  }

  // The six parts exist as one component set, so four kinds cannot fork into
  // four layouts.
  for (const part of [
    "function MarginEntryNameLine",
    "function MarginEntryKindLine",
    "function MarginEntryWhy",
    "function MarginEntryFacts",
    "function MarginEntryAppearsIn",
    "function MarginEntryRelated",
  ]) {
    assert.ok(margin.includes(part), `the entry skeleton is missing ${part}`);
  }

  // Uncertainty is content, not an error state: italic serif means proposed,
  // and it means that everywhere — unidentified sites, contested titles,
  // manuscript variants, estimates.
  assert.match(entriesCss, /\.margin-entry \.is-proposed[\s\S]*?font-style: italic;/);
  assert.match(margin, /value: "unidentified", proposed: true/);

  // Provenance is persistent, never a hover: 4px slate dot for the app's own
  // sentence, 2px seal spine and a date for the reader's.
  assert.match(entriesCss, /\.margin-entry-mark\.is-app\s*\{[\s\S]*?width: 4px;[\s\S]*?background: var\(--accent-machine\);/);
  assert.match(entriesCss, /\.margin-entry-mark\.is-reader\s*\{[\s\S]*?width: 2px;[\s\S]*?background: var\(--accent-seal\);/);
  assert.match(margin, /provenance="app"/);
  assert.match(margin, /provenance="reader" writtenOn=/);
  assert.doesNotMatch(entriesCss, /\.margin-entry-mark[^{]*\{[^}]*opacity: 0;/);

  // A bearing beats a map at 380px, and it is computed from the record's own
  // coordinates rather than written by hand.
  assert.match(margin, /export function bearingFromKnownPlace\(latitude: number, longitude: number\)/);
  assert.match(margin, /greatCircleKm\(anchor, here\)/);
  assert.match(margin, /bearingFromKnownPlace\(place\.primary\.latitude, place\.primary\.longitude\)/);
  assert.match(margin, /label: "Bearing"/);

  // Word entries keep the lexicon head, and Strong's number waits in space
  // reserved for it rather than crowding the resting row.
  assert.doesNotMatch(language, /lang-chip lang-chip-id/);
  assert.match(language, /className="margin-entry-name-key lang-detail-strong"/);
  assert.match(entriesCss, /\.margin-entry-name-key\s*\{[\s\S]*?opacity: 0;/);
  assert.match(entriesCss, /\.margin-entry:hover \.margin-entry-name-key,\s*\.margin-entry:focus-within \.margin-entry-name-key\s*\{\s*opacity: 1;/);
});

test("the research entry's head, taxonomy and description are held apart by interval", () => {
  // The clearest way to lose this again is the way it was lost the first time:
  // a rule written for the identity header's old description paragraph, which
  // outranks `.margin-entry-kind` and silently re-dresses the taxonomy — the
  // kind line is a <p>, and it is the only direct <p> child this header has.
  // Any rule matching a bare <p> under `.entity-research-identity` is that bug
  // by construction, whatever it intends to do.
  for (const [selector] of ruleBlocks()) {
    for (const single of selector.split(",")) {
      assert.doesNotMatch(
        single.trim(),
        /\.entity-research-identity(\s*>)?\s+p\b/,
        `${selector} restyles the research entry's kind line as body copy`,
      );
    }
  }

  // The interval itself: 3px between the head and the taxonomy, because they
  // are a unit and not the same line, then 14px clear of the description.
  assert.match(entriesCss, /\.margin-entry-name\s*\{[\s\S]*?margin-bottom: 3px;/);
  assert.match(entriesCss, /\.margin-entry-kind\s*\{[\s\S]*?margin: 0 0 14px;/);
  assert.match(entriesCss, /\.margin-entry-why\s*\{[\s\S]*?margin-bottom: 18px;/);
  // Nothing may take that 3px back the way the research title row once did.
  const titleRow = entriesCss.slice(
    entriesCss.indexOf(".living-margin .entity-research-title-row > .margin-entry-name"),
    entriesCss.indexOf(".living-margin .entity-research-capture"),
  );
  assert.ok(titleRow.length > 0, "the research title row's name rule has gone missing");
  assert.doesNotMatch(titleRow, /margin-bottom:\s*0/);

  // Rev 01's identity header is gone rather than merely unrendered: a kicker,
  // an <h2> page title and a chip row of person facts all describe an entry
  // the studies replaced with a dictionary head and one taxonomy line.
  for (const dead of [".entity-research-kicker", ".entity-person-facts"]) {
    assert.doesNotMatch(css, new RegExp(dead.replace(".", "\\.")), `${dead} is still dressed`);
    assert.doesNotMatch(margin, new RegExp(dead.slice(1)), `${dead} is still rendered`);
  }

  // The kind line is one line of about five words. A gazetteer title that
  // carries every spelling a source ever used is three situating facts wearing
  // one, and it is what pushed this line onto a second row.
  assert.match(margin, /function primaryTitleForm\(title: string \| undefined\)/);
  assert.match(margin, /title\?\.split\("\/"\)\[0\]\?\.trim\(\)/);
  assert.match(margin, /const containedIn = primaryTitleForm\(/);
  // If it does take two lines anyway, it breaks evenly rather than orphaning a
  // word onto a row that then reads as unexplained copy.
  assert.match(entriesCss, /\.margin-entry-kind\s*\{[\s\S]*?text-wrap: balance;/);

  // Add to note is always on the page here — nothing reveals it — so it has to
  // be legible at rest rather than wearing the row-reveal's 45% ghost.
  assert.match(
    entriesCss,
    /\.living-margin \.entity-research-capture\s*\{[\s\S]*?color: var\(--text-secondary\);[\s\S]*?opacity: 1;/,
  );
});

test("a scripture reference is one token and never breaks across lines", () => {
  // "1 Corinthians 1:12" wrapped inside the 76px column to "1 Corinthians"
  // over "1:12", which reads as two references and destroys the column the
  // fixed width exists to form.
  assert.match(entriesCss, /\.margin-entry-appears-ref\s*\{[\s\S]*?white-space: nowrap;/);

  // The book name shortens until the whole reference fits, using the edition's
  // own list of names in its own preference order. These are the exact strings
  // the studies draw, which is the check that the rule is the studies' rule and
  // not merely a rule.
  const bookNames = JSON.parse(read("data/scripture/book-names-en.json")) as Record<string, string[]>;
  for (const [ref, expected] of [
    ["ACT.18.19", "Acts 18:19"],
    ["MAT.12.27", "Matt 12:27"],
    ["MRK.9.38", "Mark 9:38"],
    ["1CO.15.32", "1 Cor 15:32"],
    ["EPH.1.1", "Eph 1:1"],
    ["1TI.1.3", "1 Tim 1:3"],
    ["REV.2.1", "Rev 2:1"],
    ["1CO.1.12", "1 Cor 1:12"],
  ] as const) {
    assert.equal(formatResearchRef(ref, bookNames), expected);
  }

  // And no reference anywhere in the canon overflows the column it sits in.
  for (const code of Object.keys(bookNames)) {
    for (const [chapter, verse] of [[1, 1], [19, 14], [119, 176]] as const) {
      const label = formatResearchRef(`${code}.${chapter}.${verse}`, bookNames);
      assert.ok(label.length <= 12, `${label} does not fit the reference column`);
      assert.doesNotMatch(label, /^[A-Z0-9]{3} /, `${code} fell back to its raw canonical code`);
    }
  }
});

test("margin entries are closed by air, not by a hairline apiece", () => {
  // Study C deleted the rule under every entry that Rev 01 drew, and kept one
  // only where two kinds of content meet and the type does not already say so.
  // A list of one kind of row — sources, relationships, occurrences, connected
  // places, citations — therefore carries at most the rule above it.
  const fencedRows: Array<[string, RegExp]> = [
    ["source rows", /\n\.margin-source-row\s*\{([^}]*)\}/],
    ["relationship rows", /\n\.entity-relationship-row\s*\{([^}]*)\}/],
    ["alternative sites", /\n\.entity-location-alternatives > div\s*\{([^}]*)\}/],
    ["gazetteer connections", /\n\.entity-pleiades-connections button\s*\{([^}]*)\}/],
    ["bibliography rows", /\n\.entity-pleiades-bibliography p\s*\{([^}]*)\}/],
    ["footprint books", /\n\.entity-footprint-books button\s*\{([^}]*)\}/],
    ["occurrence rows", /\n\.entity-reference-grid button\s*\{([^}]*)\}/],
    ["edition notes", /\n\.entity-edition-note-list > div\s*\{([^}]*)\}/],
    ["stacked note cards", /\n\.margin-subsection \.margin-card \+ \.margin-card\s*\{([^}]*)\}/],
  ];
  for (const [what, pattern] of fencedRows) {
    const block = pattern.exec(css);
    assert.ok(block, `${what} no longer has a rule to check`);
    assert.deepEqual(drawnRules(block[1]!), [], `${what} are still fenced off one by one`);
  }

  // Two rules bracketing a block is a box drawn out of hairlines, and a rule
  // on each side of a gap is a double rule. Both were on screen: More closed
  // itself and the sources disclosure opened itself, 21px apart.
  const boxed: Array<[string, RegExp]> = [
    ["the More disclosure", /\n\.entity-research-more\s*\{([^}]*)\}/],
    ["the gazetteer lead", /\n\.entity-pleiades-lead\s*\{([^}]*)\}/],
    ["the selection tools", /\n\.margin-selection-tools\s*\{([^}]*)\}/],
    ["the opening-context copy", /\n\.entity-opening-context\.is-research \.entity-opening-context-copy\s*\{([^}]*)\}/],
  ];
  for (const [what, pattern] of boxed) {
    const block = pattern.exec(css);
    assert.ok(block, `${what} no longer has a rule to check`);
    const drawn = drawnRules(block[1]!);
    assert.ok(drawn.length <= 1, `${what} is bracketed by ${drawn.join(" + ")} — that is a box, not a rule`);
  }
  assert.match(css, /\n\.entity-research-more \+ \.margin-sources\s*\{[\s\S]*?border-top: 0;/);

  // A quoted verse is "a verse and a fragment of it", which the margin has
  // exactly one shape for — the reference row. It was a filled, rounded,
  // four-sided card: a border where an interval belongs, and a third fill
  // inside the margin's paper.
  const quote = /\n\.entity-opening-context blockquote\s*\{([^}]*)\}/.exec(css);
  assert.ok(quote, "the opening-context quote no longer has a rule to check");
  assert.match(quote[1]!, /border: 0;/);
  assert.match(quote[1]!, /background: transparent;/);
  assert.doesNotMatch(quote[1]!, /border-radius: var/);

  // An alternate name is a name, not a filter control, and state is a mark
  // rather than a fill: no outlined capsules anywhere in the entry.
  const names = /\n\.entity-pleiades-names > div > span\s*\{([^}]*)\}/.exec(css);
  assert.ok(names, "the gazetteer name list no longer has a rule to check");
  assert.doesNotMatch(names[1]!, /border-radius: 999px/);
  assert.match(names[1]!, /border-bottom: 1px solid var\(--border-subtle\);/);

  // Empty is a sentence with air around it, never a dashed box with a tint.
  const unmapped = /\n\.entity-location-unmapped\s*\{([^}]*)\}/.exec(css);
  assert.ok(unmapped, "the unmapped-place state no longer has a rule to check");
  assert.doesNotMatch(unmapped[1]!, /border|background/);

  // Seal is human authorship and slate is the machine's, and a grey 2px spine
  // is neither. This sentence is the app comparing two gazetteers, so it takes
  // the machine mark — and no fill, which would be a third plane.
  const comparison = /\n\.entity-coordinate-comparison\s*\{([^}]*)\}/.exec(css);
  assert.ok(comparison, "the coordinate comparison no longer has a rule to check");
  assert.match(comparison[1]!, /border-left: 2px solid var\(--accent-machine\);/);
  assert.match(comparison[1]!, /background: transparent;/);
});

test("Living Margin is one labelled frame with truthful chapter, reading, and selected modes", () => {
  assert.match(margin, /aria-labelledby="living-margin-title"/);
  assert.match(margin, /const marginMode = connectionInspectorOpen[\s\S]{0,220}?isNear && ambientKept[\s\S]{0,100}?"kept"[\s\S]{0,100}?"following"/);
  // REWRITTEN by §C4·1. This used to assert the scope copy `Following your
  // reading ·`, `Selection ·` and `Kept on` — a whole clause per mode, set at
  // 11px beside a panel title and above a 22px repeat of the same reference.
  // The scope now reads as a sentence: serif reference, then the one sans word
  // that distinguishes the modes. "The two modes then differ by one word
  // instead of by three bands and a blockquote."
  assert.match(margin, /const scopeState = connectionInspectorOpen/);
  assert.match(margin, /\{contextReference\}/);
  for (const word of ['"selected"', '"kept"', '"following your reading"']) {
    assert.ok(margin.includes(word), `the scope line lost its ${word} state word`);
  }
  assert.doesNotMatch(margin, /const scopeCopy =/);
  // …and the clauses themselves are gone from the code, not merely unused.
  // (Comment lines are stripped: the note recording what this used to assert
  // quotes them, and a record of a deletion is not the deletion coming back.)
  const marginCode = margin.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
  assert.doesNotMatch(marginCode, /`Selection · |`Kept on |`Following your reading · /);
  assert.match(margin, /data-margin-mode=\{marginMode\}/);
  // The emitted mode tokens must match the stylesheet's accent selectors
  // exactly — a "selection"/"selected" drift once hid the pinned accent.
  assert.match(css, /\[data-margin-mode="selection"\] \.margin-frame-mode/);
  assert.match(css, /\[data-margin-mode="kept"\] \.margin-frame-mode/);
  assert.match(margin, /data-margin-view="chapter"/);
  assert.match(margin, /data-margin-view="reading"/);
  assert.match(margin, /data-margin-view="selected"/);
  assert.match(css, /\.margin-frame-header\s*\{[\s\S]*position: sticky/);
});

test("authored connection inspection is a contextual margin view over the reader's own connections", () => {
  assert.match(margin, /connectionInspector\?: React\.ReactNode/);
  assert.match(margin, /className="margin-connection-inspector" data-margin-view="connection"/);
  assert.match(margin, /margin-study-content\$\{connectionInspectorOpen \? " has-connection-inspector" : ""\}/);
  assert.doesNotMatch(margin, /margin-study-content" hidden=\{connectionInspectorOpen\}/);
  // This line used to assert the defect Quire C·4 exists for:
  //   /const connectionCount = \(crossRefs\?\.items\.length \?\? 0\) \+ noteConnectionCount/
  // — the tab's count was the edition's cross-references plus the app's
  // note-derived ones, and no authored connection at all. "A connection in this
  // app is a thing you made… Putting the edition's list under the word
  // Connections makes third-party data wear the reader's own hand." The count
  // is now authored connections in scope, and nothing else.
  assert.match(margin, /const connectionCount = passageConnections\.length/);
  assert.match(margin, /\{ id: "connections", label: "Connections", accessibleLabel: "Connections" \}/);
  assert.match(css, /\.margin-study-content\.has-connection-inspector[\s\S]*padding-top: var\(--sp-xl\)/);
  assert.doesNotMatch(css, /\.margin-study-content\[hidden\]/);
});

test("Overview is the quiet default, with stable keyboard deep-dive tabs over the current scope", () => {
  assert.match(margin, /type MarginTab = "overview" \| "connections" \| "passage" \| "notes"/);
  assert.match(
    margin,
    /const MARGIN_TABS[\s\S]*\{ id: "overview", label: "Overview"[\s\S]*\{ id: "notes", label: "Notes"[\s\S]*\{ id: "connections", label: "Connections"[\s\S]*\{ id: "passage", label: "Words"/,
    "Overview leads, then the reader's own material, then the app's — the rail is ordered by whose work it is",
  );
  assert.match(margin, /const activeTab = marginSession\.activeTab/);
  assert.doesNotMatch(margin, /internalActiveTab|controlledActiveTab/);
  assert.match(margin, /role="tablist" aria-label="Study views" aria-orientation="horizontal"/);
  assert.match(margin, /aria-selected=\{selected\}/);
  assert.match(margin, /aria-controls=\{`margin-\$\{tab\.id\}-panel`\}/);
  assert.match(margin, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(margin, /event\.key === "Enter" \|\| event\.key === "ArrowDown"/);
  assert.match(margin, /event\.key === "ArrowRight"/);
  assert.match(margin, /event\.key === "ArrowLeft"/);
  assert.match(margin, /event\.key === "Home"/);
  assert.match(margin, /event\.key === "End"/);
  assert.match(margin, /role="tabpanel"/);
  assert.match(margin, /hidden=\{activeTab !== "overview"\}/);
  assert.match(margin, /hidden=\{activeTab !== "passage"\}/);
  assert.match(margin, /hidden=\{activeTab !== "connections"\}/);
  assert.match(margin, /hidden=\{activeTab !== "notes"\}/);
  assert.doesNotMatch(margin, /tabScrollPositionsRef|workspaceScrollPositionsRef/);
  assert.match(margin, /marginSession\.scrollTopByTab\[activeTab\]/);
  assert.match(margin, /if \(event\.key !== "Tab"\) return/);
  const globalLensHandler = margin.slice(
    margin.indexOf("const cycleStudyLens"),
    margin.indexOf('window.addEventListener("keydown", cycleStudyLens'),
  );
  assert.doesNotMatch(globalLensHandler, /ArrowLeft|ArrowRight/);
  assert.match(globalLensHandler, /const reverse = event\.shiftKey/);
  assert.match(margin, /target\?\.closest\("\.verse-line"\)/);
  assert.doesNotMatch(globalLensHandler, /\.margin-tab/);
  assert.match(margin, /activateTab\(MARGIN_TABS\[nextIndex\]\?\.id \?\? "overview"\)/);
  assert.match(css, /\.margin-tabs\s*\{[\s\S]*position: sticky/);
  assert.match(css, /\.margin-tab\.is-active::after/);
});

test("translation changes preserve canonical verse selection and the reading anchor", () => {
  assert.match(page, /interface TranslationViewport/);
  assert.match(page, /captureTranslationViewport\(t\.code\)/);
  assert.match(page, /pendingTranslationViewportRef\.current/);
  assert.match(page, /lastLoadedChapterVerseTextRef\.current/);
  assert.match(page, /displayChapterVerseText=\{marginSubject\.kind === "kept" \? subjectChapterVerseText : displayChapterVerseText\}/);
  assert.match(page, /chapterTextLoading=\{marginSubject\.kind === "kept" \? resolvedKeptState == null : !chapterData && !chapterError\}/);
  assert.match(page, /const restoreReadingViewport = useCallback/);
  assert.match(page, /currentOffset - viewport\.verseOffset/);
  assert.match(page, /restoreReadingViewport\(pending\)/);
  assert.match(page, /Translation changes are deliberately excluded/);
  assert.match(page, /\}, \[book, chapter\]\);/);

  const pickerStart = page.indexOf("captureTranslationViewport(t.code)");
  const pickerEnd = page.indexOf("closeVersionPopover();", pickerStart);
  const pickerHandler = page.slice(pickerStart, pickerEnd);
  assert.doesNotMatch(pickerHandler, /setSelectedVerses\(new Set\(\)\)/);
  assert.doesNotMatch(pickerHandler, /verseSelectionAnchorRef\.current = null/);

  // REWRITTEN by §C4·1. This used to assert `const quoteVerseText =
  // displayChapterVerseText ?? chapterVerseText` — the margin's own copy of the
  // chapter text, which existed so the quoted selection under the scope bar
  // would follow a translation change. There is no quoted selection any more,
  // so there is nothing in the frame to keep in step; the research margin still
  // takes the displayed text directly, and that is the assertion now.
  assert.doesNotMatch(margin, /const quoteVerseText =/);
  assert.match(margin, /chapterVerseText=\{displayChapterVerseText \?\? chapterVerseText \?\? new Map<number, string>\(\)\}/);
  assert.match(margin, /if \(chapterTextLoading\) return/);
  assert.match(page, /el\?\.closest\("\.living-margin, \.version-picker-group, \.version-picker-popover"\)/);
});

test("reference navigation brings the selected verse to the reading eye-line after render", () => {
  assert.match(page, /interface ReferenceViewportTarget/);
  assert.match(page, /loadedChapterKeyRef\.current = loadKey/);
  assert.match(page, /setReferenceViewportTarget\(verse == null/);
  assert.match(page, /if \(loadedChapterKeyRef\.current !== `\$\{sessionOwnerTabId\}:\$\{packageId\}:\$\{book\}:\$\{chapter\}`\) return/);
  assert.match(page, /const readingEyeLine = rootRect\.height \* 0\.28/);
  assert.match(page, /root\.scrollTop = Math\.max\(0, root\.scrollTop \+ rowRect\.top - rootRect\.top - readingEyeLine\)/);
  assert.match(page, /Focus[\s\S]*stays on the invoking reference in the Living Margin/);
});

test("Overview names cross-references as the edition's and keeps three rows at every scope", () => {
  // This test used to be called "Overview surfaces only grounded Scripture,
  // library, and TIPNR entity leads" and asserted `crossRefs?.items.slice(0, 2)`
  // under a head that read "Scripture". Quire C4·3 retires both:
  //   · the head is "Cross-references", with the count stating whose they are,
  //     because putting the edition's list under a name the reader could read
  //     as their own is the same error class as unmarked licensed prose; and
  //   · §C4·5 fixes the section at three rows and an "All n" — "a section never
  //     changes its shape because the scope changed size" — so two rows is a
  //     retired number, not a smaller one.
  assert.match(margin, /function IntentOverview/);
  assert.match(margin, /title="Cross-references"/);
  assert.match(margin, /· edition`/, "the cross-reference count must state whose it is");
  assert.doesNotMatch(
    margin,
    /<h3 id="intent-scripture-title">Scripture<\/h3>/,
    "the retired 'Scripture' head is back",
  );
  assert.match(margin, /crossRefItems\.slice\(0, 3\)/);
  assert.match(margin, /semantic\?\.semanticNotes\[0\]/);
  assert.match(margin, /Theme in your notes/);
  assert.match(margin, /Grounded in your notes/);
  assert.match(margin, /People &amp; places/);
  assert.match(margin, /getEntitiesForRange/);
  assert.match(margin, /STEPBible TIPNR/);
  assert.doesNotMatch(margin, /relationshipKinds\.push/);
});

test("the entity list is never re-ranked", () => {
  // §C4·5: "Text order, always — the order the reader met them in. Ranking by
  // frequency would put Paul first in every chapter of Acts and teach the
  // reader nothing." `refCount` is drawn in the row and must never be ordered
  // on, in the renderer or in the index that feeds it.
  const overview = margin.slice(
    margin.indexOf("function IntentOverview"),
    margin.indexOf("export function LivingMargin"),
  );
  assert.doesNotMatch(overview, /\.sort\(/, "the overview must not sort anything");
  assert.doesNotMatch(overview, /refCount\s*-\s*/, "entities must not be ranked by frequency");

  const tipnr = read("src/core/language/tipnr.ts");
  const forRange = tipnr.slice(
    tipnr.indexOf("entitiesForRange("),
    tipnr.indexOf("resolve(q: NameResolveQuery)"),
  );
  assert.doesNotMatch(forRange, /\.sort\(/, "entitiesForRange must return text order");
  assert.match(tipnr, /Ordering follows first appearance, never global popularity/);
});

test("People and place actions use explicit workspace language", () => {
  assert.match(margin, /Open research tab for/);
  // The name is the handle, so the destination is named once, in its
  // accessible name. The "Open research tab →" caption it replaces was a
  // hover reveal that also translated 2px — geometry moving on hover, which
  // the language forbids outright.
  //
  // This used to read `openLabel={`Open research tab for ${entity.displayName}`}`,
  // because the overview's entities were drawn with the C·2 entry skeleton and
  // `MarginEntryNameLine` took the label as a prop. Quire C4·3 puts the four
  // names in a 16px fixed-width column instead — no entry, no name line, no
  // brief — so the same sentence is now the button's own `aria-label`. The
  // rule the assertion protects is unchanged: the destination is named, once,
  // where a screen reader will read it.
  assert.match(margin, /aria-label=\{`Open research tab for \$\{entity\.displayName\}`\}/);
  assert.doesNotMatch(margin, /intent-entity-open/);
  assert.match(margin, /Open .* in a new research tab/);
  assert.match(margin, /Open .* as a passage tab/);
  assert.match(margin, /Opened from/);
  assert.match(margin, /Viewing/);
  assert.match(margin, /Close research tab/);
});

test("tab content preserves public and personal trust boundaries", () => {
  const passageStart = margin.lastIndexOf('id="margin-passage-panel"');
  const connectionsStart = margin.lastIndexOf('id="margin-connections-panel"');
  const notesStart = margin.lastIndexOf('id="margin-notes-panel"');
  const passagePanel = margin.slice(
    passageStart,
    connectionsStart,
  );
  const connectionsPanel = margin.slice(
    connectionsStart,
    notesStart,
  );
  const notesPanel = margin.slice(notesStart);

  assert.match(passagePanel, /LanguageWordsSection/);
  // These two lines used to assert the defect Quire C·4 exists for:
  //   assert.match(connectionsPanel, /CrossRefsBlock/);
  //   assert.match(connectionsPanel, /NoteCrossRefsBlock/);
  // The Connections tab rendered the edition's cross-reference list and the
  // app's note-derived one, and nothing the reader had authored. Cross-
  // references stay in Overview under their own name, marked as the edition's;
  // Connections shows connections. Both blocks were re-implemented on C4·2's
  // compact row rather than re-parented — their mono heading and their
  // `.crossref-row` are retired drawings — so both are deleted, and neither
  // they nor their copy may come back anywhere in this file.
  assert.doesNotMatch(connectionsPanel, /CrossRefsBlock/);
  assert.doesNotMatch(connectionsPanel, /NoteCrossRefsBlock/);
  assert.match(connectionsPanel, /<ConnectionsPanel/);
  // Was: assert.match(margin, /Related verses/) and /Connections in your library/
  assert.doesNotMatch(margin, /function CrossRefsBlock|function NoteCrossRefsBlock|function CrossReferenceRow/);
  assert.match(margin, /title="Cross-references"/);
  assert.match(notesPanel, /Passage insight/);
  assert.match(notesPanel, /notes-deep-dive/);
  assert.match(notesPanel, /DeepNoteCard/);
  assert.doesNotMatch(notesPanel, /NoteCrossRefsBlock/);
});

test("chapter top remains an overview before the margin follows the reading eye-line", () => {
  assert.match(page, /if \(root\.scrollTop < 72\) \{[\s\S]*setNearVerse/);
  assert.match(page, /const marginHasPointer = document\.querySelector\("\.living-margin"\)\?\.matches\(":hover"\) \?\? false/);
  assert.doesNotMatch(page, /studyLockVerseRef/);
  assert.match(page, /const eyeY = rootRect\.top \+ rootRect\.height \* 0\.32/);
  assert.match(page, /nearVerse=\{marginSubject\.kind === "selection"[\s\S]{0,180}?marginSubject\.kind === "kept"[\s\S]{0,120}?marginSubject\.verse[\s\S]{0,80}?: settledNearVerse\}/);
});

test("selected-passage note evidence never falls back to chapter-wide semantic data", () => {
  assert.match(margin, /const pinnedSemantic = pinnedAiResult \?\? null/);
  assert.doesNotMatch(margin, /pinnedAiResult \?\? semanticData/);
  assert.match(margin, /Passage insight from your notes/);
  assert.match(margin, /From your notes/);
});

test("the quoted selection and its disclosure are gone, and Notes still exposes complete deep-dive material", () => {
  // REWRITTEN by §C4·1. This test used to assert the progressive disclosure of
  // the quoted selection: `const canExpand = text.length > 220`, the words
  // "Read full selection", the toggle's `aria-expanded`, and a
  // `.margin-focus-quote.is-collapsed` clamped to four lines.
  //
  // All of it is deleted. "A truncated copy of two verses, offered beside the
  // full, untruncated originals 300px to the left. It cost 140px and a Read
  // full selection link whose answer is 'look left'." A disclosure is only
  // progressive if the rest of the thing is somewhere the reader cannot see;
  // here it was on screen the whole time.
  assert.doesNotMatch(marginSource, /function PassageQuote/);
  assert.doesNotMatch(marginSource, /Read full selection|Show less/);
  assert.doesNotMatch(marginSource, /const canExpand = text\.length > 220/);
  assert.doesNotMatch(marginSource, /margin-focus-quote|margin-quote-toggle|margin-quote-wrap/);
  assert.doesNotMatch(cssCode, /\.margin-focus-quote|\.margin-quote-toggle|\.margin-quote-wrap/);
  // Nothing quotes the scope any more, so nothing repeats the reference under
  // the bar that already says it.
  assert.doesNotMatch(marginSource, /margin-header-ref|className="margin-context"/);
  assert.doesNotMatch(cssCode, /\.margin-header-ref\s*\{|\.margin-context\s*\{/);

  // Notes' own deep-dive material is untouched by any of that — it was never
  // the quotation, and it is the surface that genuinely holds more than it
  // shows.
  assert.match(margin, /function DeepNoteCard/);
  assert.match(margin, /window\.api\.library\.readAllNotes/);
  assert.match(margin, /Complete related material from your notes/);
  assert.doesNotMatch(margin, /function MarginDisclosure/);
  assert.match(css, /\.deep-note-body[\s\S]*white-space: pre-wrap/);
});

test("Clear restores focus to the persistent scope line", () => {
  // AMENDED by §C4·1. The focus target used to be the word "Study" — a panel
  // title that "never changes and never distinguishes anything". It is now the
  // scope line itself, which is the panel's real name and says what the reader
  // has just been returned to. Same ref, same id, same tabIndex; different
  // heading.
  assert.match(margin, /window\.setTimeout\(\(\) => frameTitleRef\.current\?\.focus\(\), 0\)/);
  assert.match(margin, /ref=\{frameTitleRef\}[\s\S]*tabIndex=\{-1\}/);
  assert.match(margin, /ref=\{frameTitleRef\}[\s\S]{0,140}className="margin-frame-scope"/);
  assert.doesNotMatch(marginSource, /className="margin-frame-title"/);
  assert.doesNotMatch(cssCode, /\.margin-frame-title/);
  assert.match(page, /const handleClearMarginSelection = useCallback\(\(expectedNonce\?: number\) => \{[\s\S]*setSelectedVerses\(new Set\(\)\)/);
  assert.match(page, /onClearSelection=\{handleClearMarginSelection\}/);
});

test("§C4·1 · the tab row sits at the same y in chapter scope and in selection", () => {
  // This is the whole claim of §C4·1 and it is the thing that will silently
  // regress, so it is measured rather than eyeballed. Shipped, selecting a
  // verse pushed the tab row down roughly 300px, because a quoted copy of the
  // selected text was inserted above it. Navigation should not move.
  //
  // The tab row's y is (header band) + (whatever renders between them). The
  // three assertions below pin all three terms.

  // 1 · The band is one fixed height, not a floor. `min-height` is what let
  //     the header grow when its contents did; a header that can grow is a tab
  //     row that can move. 62px is the drawn band.
  assert.match(css, /--margin-header-h: 62px;/);
  const header = ruleBody(".margin-frame-header");
  assert.match(header, /height: var\(--margin-header-h\);/);
  assert.doesNotMatch(header, /min-height/, "the scope bar is a fixed band, never a minimum");

  // 2 · Nothing separates the two. The header carries no bottom margin and the
  //     tab row carries no top margin, so the row's resting y and its stuck y
  //     are the same number in both modes.
  assert.match(header, /margin: 0 calc\(var\(--sp-xl\) \* -1\);/);
  const tabs = ruleBody(".margin-tabs");
  assert.match(tabs, /top: var\(--margin-header-h\);/);
  assert.match(tabs, /margin: 0 calc\(var\(--sp-xl\) \* -1\) 18px;/);

  // 3 · The same holds in the stacked ≤760px dock, which re-pads the header.
  const compactHeader = ruleBody(".scripture-body > .living-margin .margin-frame-header");
  assert.match(compactHeader, /margin: 0 -12px;/, "the compact dock reinstated a gap under the scope bar");

  // 4 · Nothing rendered between the scope bar and the tab row may depend on
  //     the scope. This is the assertion that would have caught the shipped
  //     defect: `.margin-context` sat here and grew by a blockquote the moment
  //     a verse was chosen.
  const scopeBar = margin.indexOf('<header className="margin-frame-header">');
  const headerEnd = margin.indexOf("</header>", scopeBar);
  const tabRow = margin.indexOf('className="margin-tabs"', headerEnd);
  assert.ok(scopeBar !== -1 && headerEnd !== -1 && tabRow > headerEnd, "the scope bar and the tab row have moved apart");
  const between = withoutComments(margin.slice(headerEnd, tabRow));
  for (const scopeSignal of [
    "isPinned",
    "isNear",
    "ambientKept",
    "pinnedRange",
    "nearVerse",
    "contextReference",
    "pinnedRef",
    "scopeState",
    "PassageQuote",
  ]) {
    assert.ok(
      !between.includes(scopeSignal),
      `${scopeSignal} is read between the scope bar and the tab row — the tab row can now move when the scope changes`,
    );
  }

  // 5 · The verb slot is reserved rather than conditional. "In chapter scope
  //     the slot is empty — 'following your reading' has nothing to clear. The
  //     slot stays reserved so the tab row never shifts by a pixel between the
  //     two modes." The element renders in every mode; only its contents are
  //     conditional, and it ends the line either way.
  assert.match(margin, /<div className="margin-frame-verb">/);
  assert.doesNotMatch(margin, /\{[^\n]*&&[^\n]*<div className="margin-frame-verb">/);
  assert.match(ruleBody(".margin-frame-verb"), /margin-left: auto;/);
});

test("§C4·1 · the scope bar is one line, and every tab that counts something says whose", () => {
  // The two deletions, and the line that licensed each.
  //
  // "Study" — "it is the only panel in the column and it is permanently on
  // screen. A title that never changes and never distinguishes anything is a
  // 34px band spent on nothing."
  assert.doesNotMatch(marginSource, />\s*Study\s*<\/h2>/);
  assert.doesNotMatch(cssCode, /\.margin-frame-title/);
  // The panel keeps its accessible name and its focus target: the id moved
  // onto the scope line, which is the panel's real name.
  assert.match(margin, /id="living-margin-title"\n\s*className="margin-frame-scope"/);
  assert.match(margin, /aria-labelledby="living-margin-title"/);

  // Serif reference, sans state word, and the verb on the right.
  const scope = ruleBody(".margin-frame-scope");
  assert.match(scope, /font-family: var\(--font-reading\);/);
  assert.match(scope, /font-size: 19px;/);
  const mode = ruleBody(".margin-frame-mode");
  assert.match(mode, /font-family: var\(--font-ui\);/);
  assert.match(mode, /font-size: 11px;/);

  // §C4·6 · "Verbs are words in a footer. No bordered buttons, no circular
  // chips." Clear has no radius and no fill of its own, and its hover moves
  // ink only.
  const verb = ruleBody(".margin-frame-verb .margin-frame-action");
  assert.match(verb, /border-radius: 0;/);
  const verbHover = ruleBody(".margin-frame-verb .margin-frame-action:hover");
  assert.match(verbHover, /background: transparent;/);

  // §C4·6 · "All four tabs carry counts. Inline, 12.5px. Seal when the count
  // is yours, faint when it is the edition's, absent when the tab is
  // disabled." Shipped, only Connections had one and it was a superscript.
  const count = ruleBody(".margin-tab-count");
  assert.match(count, /font-size: 12\.5px;/);
  assert.match(count, /font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(count, /transform:/, "the count is inline, not a superscript");
  assert.match(count, /color: var\(--text-tertiary\);/);
  assert.match(ruleBody(".margin-tab-count.is-yours"), /color: var\(--accent-seal\);/);
  // Provenance is carried by ink (Law 3), so the count states whose it is, and
  // a zero is never seal — `Notes 0` faint, `Notes 4` seal, on one tab.
  assert.match(margin, /provenance: "reader" \| "edition"/);
  assert.match(margin, /count\.provenance === "reader" && count\.value > 0/);
  // A count of nothing is drawn where the tab is in scope; withheld only where
  // the tab is off. "Disabled is the label without its count."
  assert.match(margin, /const count = disabled \? null : tabCount\(tab\.id\)/);
  assert.doesNotMatch(margin, /count != null && count > 0/);
  const disabledTab = ruleBody(".margin-tab.is-disabled-instrument, .margin-tab.is-disabled-instrument:hover");
  assert.match(disabledTab, /color: var\(--text-tertiary\);/);
  assert.doesNotMatch(disabledTab, /opacity/, "disabled is ink-3, not a ghost under Law 6's floor");

  // §4·4 · every focus ring on this bar is full-strength seal. The tab row's
  // was `color-mix(var(--study-gold) 72%, transparent)` — about 2.6:1 over
  // paper, under Law 6's 3:1 floor for a mark that carries meaning without
  // words, which is the ".4 wash a keyboard user gets nothing from" §4·4
  // struck. No focus rule on this surface may dilute the ink again.
  for (const focusRule of [
    ".margin-tab:focus-visible",
    ".margin-frame-scope:focus-visible",
    ".margin-frame-verb .margin-frame-action:focus-visible",
    ".study-ref-row-verb:focus-visible",
    ".study-ref-row--compact:focus-visible",
  ]) {
    const body = ruleBody(focusRule);
    assert.match(body, /outline: 2px solid var\(--accent-seal\);/, `${focusRule} is not full-strength seal`);
    assert.doesNotMatch(body, /color-mix|--study-gold-focus|rgba\(/, `${focusRule} dilutes the focus ink`);
  }
});

test("§C4·2 · a verse-with-a-fragment is one object with two drawings", () => {
  // "It is one object and it gets one drawing." There were five: Overview
  // clamped to two lines with a floating ↗, Connections ran to nine lines with
  // a floating "Add to note…", Words used a third, the research pane a fourth.
  for (const required of [
    ".study-ref-row-list",
    ".study-ref-row",
    ".study-ref-row--compact",
    ".study-ref-row--quoted",
    ".study-ref-row-head",
    ".study-ref-row-ref",
    ".study-ref-row-verbs",
    ".study-ref-row-verb",
    ".study-ref-row-text",
  ]) {
    assert.ok(
      ruleBlocks().some(([selector]) => selector.split(",").some((one) => one.trim().startsWith(required))),
      `${required} is not drawn`,
    );
  }
  // Two variants only. A third modifier is the five treatments starting again.
  const variants = new Set([...css.matchAll(/\.study-ref-row--([\w-]+)/g)].map((match) => match[1]!));
  assert.deepEqual([...variants].sort(), ["compact", "quoted"]);

  // compact · "Reference on its own line, never bold, tabular figures."
  const ref = ruleBody(".study-ref-row-ref");
  assert.match(ref, /font-weight: var\(--fw-normal\);/);
  assert.match(ref, /font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(ref, /font-weight: var\(--fw-(medium|semibold)\)/);

  // compact · "Two lines of verse, clamped without an ellipsis character — the
  // fade of a cut line is enough."
  const compactText = ruleBody(".study-ref-row--compact .study-ref-row-text");
  assert.match(compactText, /max-height: calc\(1lh \* 2\);/);
  assert.match(compactText, /overflow: hidden;/);
  assert.doesNotMatch(compactText, /line-clamp/, "-webkit-line-clamp stamps a literal … that no rule can remove");
  assert.doesNotMatch(compactText, /text-overflow/);

  // §C4·6 · the fade "must work on both planes and in all four atmospheres".
  // A mask takes the plane's own pixels; a gradient to a literal colour is a
  // bright smear on the dark pair, and a gradient to var(--bg-reading) is a
  // patch anywhere the row is not flat on paper.
  assert.match(compactText, /mask-image:/);
  assert.match(compactText, /-webkit-mask-image:/);
  assert.doesNotMatch(compactText, /#fff|#FFF|白|rgba\(255|\bwhite\b/);
  assert.doesNotMatch(compactText, /background:/);

  // compact · "Verbs appear on hover, top-aligned with the reference, in
  // reserved space." Shipped, they were vertically centred, "so on a nine-line
  // row the verb floats in the middle of a paragraph with nothing beside it".
  assert.match(ruleBody(".study-ref-row-head"), /align-items: baseline;/);
  const verbs = ruleBody(".study-ref-row-verbs");
  assert.match(verbs, /opacity: 0;/);
  assert.match(verbs, /margin-left: auto;/);
  assert.match(
    css,
    /\.study-ref-row--compact:hover \.study-ref-row-verbs,[\s\S]{0,200}?\{\s*opacity: 1;/,
  );

  // §C4·6 · "Verbs are words in a footer. No bordered buttons, no circular
  // chips, no repeated Add to note… floating beside a paragraph."
  const verb = ruleBody(".study-ref-row-verb");
  assert.match(verb, /border: 0;/);
  assert.match(verb, /border-radius: 0;/);
  assert.match(verb, /background: transparent;/);

  // quoted · "Full text, ink rather than ink-2, and no trailing verb at all:
  // quoted rows are read, not chosen from."
  const quotedText = ruleBody(".study-ref-row--quoted .study-ref-row-text");
  assert.match(quotedText, /color: var\(--text-primary\);/);
  assert.doesNotMatch(quotedText, /max-height|overflow: hidden|mask-image/);
  assert.match(ruleBody(".study-ref-row--quoted .study-ref-row-verbs"), /display: none;/);

  // §4·2 · rows are closed by air. A list of one kind of row carries no rules
  // between its items.
  const list = ruleBody(".study-ref-row-list");
  assert.match(list, /gap: 14px;/);
  assert.deepEqual(drawnRules(list), []);

  for (const [selector, body] of ruleBlocks()) {
    if (!/\.study-ref-row/.test(selector)) continue;
    // §C4·6 · no mono on this surface. Tabular figures do the aligning.
    assert.doesNotMatch(body, /--font-mono/, `${selector} sets a reference row in the chrome voice`);
    // Space for every reveal exists at rest, so a reveal may change opacity and
    // ink and nothing else.
    if (/:hover|:focus-within/.test(selector)) {
      assert.doesNotMatch(
        body,
        /(^|[;{\s])(transform|translate|width|height|margin|padding|font-size|display|inset|top|left|right|bottom)\s*:/,
        `${selector} moves geometry on hover`,
      );
    }
  }
});

test("§C4·2 · never both row variants in one list", () => {
  // The rule the five treatments break first. A list mixing a clamped row with
  // a full-text one is two grammars in one column, and it reads as two kinds of
  // thing when it is one. If a surface needs both, it needs two lists.
  //
  // The prohibition is also structural in the sheet — a verb inside a quoted
  // row does not render at all — but that only stops half of it, so the other
  // half is checked here.
  assert.match(css, /\.study-ref-row--quoted \.study-ref-row-verbs\s*\{\s*display: none;/);

  for (const [path, source] of rendererComponents()) {
    for (const body of mapCallbacks(source)) {
      const compact = body.includes("study-ref-row--compact");
      const quoted = body.includes("study-ref-row--quoted");
      assert.ok(
        !(compact && quoted),
        `${path} draws both a compact and a quoted reference row in one list`,
      );
    }
    // The variant is never computed, either — a ternary that picks a modifier
    // per row is a mixed list with the mixing hidden one level down.
    assert.doesNotMatch(
      source,
      /study-ref-row--\$\{|\?\s*"study-ref-row--|study-ref-row--(compact|quoted)"\s*:\s*"study-ref-row--/,
      `${path} chooses a reference-row variant per row rather than per list`,
    );
  }
});

test("the multi-verse Words chooser wraps APG arrows and keeps a stable focus owner", () => {
  assert.match(margin, /const group = event\.currentTarget/);
  assert.match(margin, /wordsVerse === pinnedRange\.end \? pinnedRange\.start : wordsVerse \+ 1/);
  assert.match(margin, /wordsVerse === pinnedRange\.start \? pinnedRange\.end : wordsVerse - 1/);
  assert.match(margin, /group\.querySelector<HTMLButtonElement>/);
  assert.doesNotMatch(margin, /window\.setTimeout\(\(\) => \{\s*\(event\.currentTarget\.querySelector/);
});
