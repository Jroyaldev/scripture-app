import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf-8");
const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");

test("Living Margin is one labelled frame with truthful chapter, reading, and selected modes", () => {
  assert.match(margin, /aria-labelledby="living-margin-title"/);
  assert.match(margin, /const marginMode = connectionInspectorOpen \? "Connection" : isPinned \? "selection" : "following"/);
  assert.match(margin, /Following your reading ·/);
  assert.match(margin, /Selection ·/);
  assert.match(margin, /data-margin-mode=\{marginMode\.toLowerCase\(\)\.replace\(" ", "-"\)\}/);
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
  assert.match(margin, /\{ id: "connections", label: "Related", accessibleLabel: "Related verses" \}/);
  assert.doesNotMatch(margin, /connectionCount[\s\S]{0,100}marginData\.connections/);
  assert.match(css, /\.margin-study-content\.has-connection-inspector[\s\S]*padding-top: var\(--sp-xl\)/);
  assert.doesNotMatch(css, /\.margin-study-content\[hidden\]/);
});

test("Overview is the quiet default, with stable keyboard deep-dive tabs over the current scope", () => {
  assert.match(margin, /type MarginTab = "overview" \| "connections" \| "passage" \| "notes"/);
  assert.match(margin, /const MARGIN_TABS[\s\S]*\{ id: "overview", label: "Overview"[\s\S]*\{ id: "connections", label: "Related"/);
  assert.match(margin, /useState<MarginTab>\("overview"\)/);
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
  assert.match(margin, /tabScrollPositionsRef/);
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
  assert.match(page, /displayChapterVerseText=\{displayChapterVerseText\}/);
  assert.match(page, /chapterTextLoading=\{!chapterData && !chapterError\}/);
  assert.match(page, /root\.scrollTop = Math\.max\(0, root\.scrollTop \+ currentOffset - pending\.verseOffset\)/);
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
  assert.match(page, /if \(loadedChapterKeyRef\.current !== `\$\{packageId\}:\$\{book\}:\$\{chapter\}`\) return/);
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
  assert.match(page, /nearVerse=\{pinnedRange \? null : nearVerse\}/);
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
