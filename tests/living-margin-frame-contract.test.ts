import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(margin, /Following your reading ·/);
  assert.match(margin, /Selection ·/);
  assert.match(margin, /Kept on/);
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

test("authored connection inspection is a contextual margin view, not a replacement for Related", () => {
  assert.match(margin, /connectionInspector\?: React\.ReactNode/);
  assert.match(margin, /className="margin-connection-inspector" data-margin-view="connection"/);
  assert.match(margin, /margin-study-content\$\{connectionInspectorOpen \? " has-connection-inspector" : ""\}/);
  assert.doesNotMatch(margin, /margin-study-content" hidden=\{connectionInspectorOpen\}/);
  assert.match(margin, /const connectionCount = \(crossRefs\?\.items\.length \?\? 0\) \+ noteConnectionCount/);
  assert.match(margin, /\{ id: "connections", label: "Connections", accessibleLabel: "Connections" \}/);
  assert.doesNotMatch(margin, /connectionCount[\s\S]{0,100}marginData\.connections/);
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

  assert.match(margin, /const quoteVerseText = displayChapterVerseText \?\? chapterVerseText/);
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

test("Overview surfaces only grounded Scripture, library, and TIPNR entity leads", () => {
  assert.match(margin, /function IntentOverview/);
  assert.match(margin, /crossRefs\?\.items\.slice\(0, 2\)/);
  assert.match(margin, /semantic\?\.semanticNotes\[0\]/);
  assert.match(margin, /Theme in your notes/);
  assert.match(margin, /Grounded in your notes/);
  assert.match(margin, /People &amp; places/);
  assert.match(margin, /getEntitiesForRange/);
  assert.match(margin, /STEPBible TIPNR/);
  assert.doesNotMatch(margin, /relationshipKinds\.push/);
});

test("People and place actions use explicit workspace language", () => {
  assert.match(margin, /Open research tab for/);
  // The entry's name line is the handle, so the destination is named once, in
  // its accessible name. The "Open research tab →" caption it replaces was a
  // hover reveal that also translated 2px — geometry moving on hover, which
  // the language forbids outright.
  assert.match(margin, /openLabel=\{`Open research tab for \$\{entity\.displayName\}`\}/);
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
  assert.match(connectionsPanel, /CrossRefsBlock/);
  assert.match(connectionsPanel, /NoteCrossRefsBlock/);
  assert.match(margin, /Related verses/);
  assert.match(margin, /Connections in your library/);
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

test("long passage quotes disclose progressively while Notes exposes complete deep-dive material", () => {
  assert.match(margin, /const canExpand = text\.length > 220/);
  assert.match(margin, /Read full selection/);
  assert.match(margin, /aria-expanded=\{expanded\}/);
  assert.match(margin, /function DeepNoteCard/);
  assert.match(margin, /window\.api\.library\.readAllNotes/);
  assert.match(margin, /Complete related material from your notes/);
  assert.doesNotMatch(margin, /function MarginDisclosure/);
  assert.match(css, /\.margin-focus-quote\.is-collapsed[\s\S]*-webkit-line-clamp: 4/);
  assert.match(css, /\.deep-note-body[\s\S]*white-space: pre-wrap/);
});

test("Done clears selection and restores focus to the persistent Study heading", () => {
  assert.match(margin, /window\.setTimeout\(\(\) => frameTitleRef\.current\?\.focus\(\), 0\)/);
  assert.match(margin, /ref=\{frameTitleRef\}[\s\S]*tabIndex=\{-1\}/);
  assert.match(page, /const handleClearMarginSelection = useCallback\(\(expectedNonce\?: number\) => \{[\s\S]*setSelectedVerses\(new Set\(\)\)/);
  assert.match(page, /onClearSelection=\{handleClearMarginSelection\}/);
});

test("the multi-verse Words chooser wraps APG arrows and keeps a stable focus owner", () => {
  assert.match(margin, /const group = event\.currentTarget/);
  assert.match(margin, /wordsVerse === pinnedRange\.end \? pinnedRange\.start : wordsVerse \+ 1/);
  assert.match(margin, /wordsVerse === pinnedRange\.start \? pinnedRange\.end : wordsVerse - 1/);
  assert.match(margin, /group\.querySelector<HTMLButtonElement>/);
  assert.doesNotMatch(margin, /window\.setTimeout\(\(\) => \{\s*\(event\.currentTarget\.querySelector/);
});
