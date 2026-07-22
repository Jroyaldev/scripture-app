import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const readRendererSource = (name: string): string => readFileSync(
  join(repoRoot, "src", "renderer", "components", name),
  "utf-8",
);

const page = readRendererSource("ScripturePage.tsx");
const markingSurface = readRendererSource("MarkingSurface.tsx");
const underlay = readRendererSource("ConnectionUnderlay.tsx");
const card = readRendererSource("ConnectionCard.tsx");
const margin = readRendererSource("LivingMargin.tsx");
const commandPalette = readRendererSource("CommandPalette.tsx");
const noteCapture = readRendererSource("NoteCapture.tsx");
const shortcuts = readRendererSource("ShortcutsOverlay.tsx");
const structure = readRendererSource("StructureModal.tsx");
const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");
const readingQa = readFileSync(join(repoRoot, "scripts", "qa-reading-interactions.mjs"), "utf-8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  assert.ok(end > start, `source markers are out of order: ${startMarker}`);
  return source.slice(start, end);
}

test("connected-word hit testing reuses exact durable paint in the underlay's own pointer-transparent frame", () => {
  const hitTest = sourceBetween(
    underlay,
    "useLayoutEffect(() => {\n    if (!wordHitTestRef) return;",
    "  const invalidateLayout",
  );

  assert.match(hitTest, /const overlay = emphasisRef\.current/);
  assert.match(hitTest, /const bounds = overlay\.getBoundingClientRect\(\)/);
  assert.match(hitTest, /const x = \(clientX - bounds\.left\) \* \(size\.width \/ bounds\.width\)/);
  assert.match(hitTest, /const y = \(clientY - bounds\.top\) \* \(size\.height \/ bounds\.height\)/);
  assert.match(hitTest, /for \(const item of painted\)/);
  assert.match(hitTest, /if \(!isDurablePaintRecord\(item\.connection\)\) continue/);
  assert.match(hitTest, /const currentConnection = currentDurableConnectionById\.get\(item\.connection\.id\)/);
  assert.match(hitTest, /hits\.push\(\{ connection: currentConnection, area: exactArea \}\)/);
  assert.match(hitTest, /wordHitTestRef\.current = hitTest/);
  assert.doesNotMatch(hitTest, /createRange|getClientRects|TreeWalker/);
  assert.match(underlay, /data-connection-overlay-frame="self"/);
  assert.match(underlay, /return currentDurableConnectionById\.has\(item\.connection\.id\)/);
  assert.match(css, /\.connection-emphasis-underlay,\s*\n\.connection-underlay\s*\{[\s\S]{0,320}pointer-events: none/);
  assert.match(css, /\.connection-emphasis-wash\s*\{[\s\S]{0,180}pointer-events: none/);
});

test("coarse and hybrid pointers receive nonoverlapping 38x44 tick targets with explicit overflow groups", () => {
  assert.match(underlay, /window\.matchMedia\("\(any-pointer: coarse\)"\)/);
  assert.match(underlay, /media\.addEventListener\("change", syncPointerMode\)/);
  assert.match(underlay, /media\.removeEventListener\("change", syncPointerMode\)/);
  assert.match(underlay, /planConnectionTickLanes\([\s\S]{0,420}coarsePointer \? 45 : 25,[\s\S]{0,80}coarsePointer \? 10 : 2/);
  assert.match(underlay, /data-connection-tick-aggregate=\{aggregate \? "" : undefined\}/);
  assert.match(underlay, /aria-haspopup=\{aggregate \? "dialog" : undefined\}/);
  assert.match(css, /@media \(any-pointer: coarse\) \{\s*\.connection-tick::before \{\s*position: absolute;\s*inset: -10px -7px;/);
});

test("a verse click consumes drag residue, resolves exact connection hits, then falls back to Study with marking closed", () => {
  const clickHandler = sourceBetween(
    page,
    "const handleVerseClick = useCallback",
    "  const handleVerseKeyDown",
  );
  const studySelection = sourceBetween(
    page,
    "const selectStudyScope = useCallback",
    "  const handleVerseClick",
  );

  assert.match(clickHandler, /if \(suppressNextClickRef\.current\) \{\s*suppressNextClickRef\.current = false;\s*return;/);
  assert.match(clickHandler, /nativeSelectionCollapsed && unmodified[\s\S]{0,160}connectionWordHitTestRef\.current\?\./);
  assert.match(clickHandler, /resolveReadingPointerIntent\(\{[\s\S]{0,160}connectionHitCount: hits\.length/);
  assert.match(clickHandler, /if \(intent === "connection"\)[\s\S]{0,600}handleSelectConnection\(ordered\[0\]!\.connection\)/);
  assert.match(clickHandler, /selectStudyScope\(verse, event\.shiftKey\)/);
  assert.doesNotMatch(clickHandler, /setShowHighlightPalette\(true\)/);

  assert.match(studySelection, /setShowHighlightPalette\(false\)/);
  assert.match(studySelection, /const result = nextVerseSelection\(/);
  assert.match(studySelection, /setSelectedVerses\(result\.selection\)/);
  assert.match(studySelection, /onEnsureMarginVisible\?\.\(\)/);
});

test("a Scripture drag commits on document mouseup when release leaves the text container", () => {
  const documentRelease = sourceBetween(
    page,
    "// Commit by gesture origin, not release target",
    "  // Re-anchor the palette",
  );

  assert.match(page, /const textSelectionGestureRef = useRef\(false\)/);
  assert.match(documentRelease, /document\.addEventListener\("mousedown", handleDocumentMouseDown, true\)/);
  assert.match(documentRelease, /target\?\.closest\("\.verse-text-span"\) != null/);
  assert.match(documentRelease, /verseTextRef\.current\?\.contains\(target\) === true/);
  assert.match(documentRelease, /document\.addEventListener\("mouseup", handleDocumentMouseUp\)/);
  assert.match(documentRelease, /if \(event\.button !== 0\) return;[\s\S]{0,360}if \(!textSelectionGestureRef\.current\) return;/);
  assert.match(documentRelease, /textSelectionGestureRef\.current = false;\s*void handleTextMouseUp\(\)/);
  assert.match(documentRelease, /document\.addEventListener\("pointercancel", cancelTextSelectionGesture\)/);
  assert.match(documentRelease, /window\.addEventListener\("blur", cancelTextSelectionGesture\)/);
  assert.match(page, /const suppressTrailingDragClick = useCallback[\s\S]{0,700}window\.setTimeout\(\(\) => \{[\s\S]{0,180}suppressNextClickRef\.current = false;[\s\S]{0,60}\}, 0\)/);
  assert.match(page, /suppressTrailingDragClick\(\);[\s\S]{0,120}if \(!await requestCanvasResearchExit\(\)\) return;/);
  assert.doesNotMatch(page, /onMouseDown=\{\(event\) => \{\s*suppressNextClickRef\.current = false/);
  assert.doesNotMatch(page, /onMouseUp=\{handleTextMouseUp\}/);
});

test("Study scope cannot enter exact marking capture unless the marking surface is explicitly open", () => {
  const paintAnchors = sourceBetween(
    page,
    "const markingSelectionPaintAnchors = useMemo",
    "  const markingSelectionPieces",
  );
  const captureEffect = sourceBetween(
    page,
    "useEffect(() => {\n    const contextKey = `${sessionOwnerTabId}:${book}:${chapter}:${packageId}`;",
    "  const markingSelection = useMemo",
  );
  const markingSelection = sourceBetween(
    page,
    "const markingSelection = useMemo",
    "  const hasMarkingSelection",
  );

  assert.match(paintAnchors, /if \(!showHighlightPalette\) return \[\]/);
  assert.match(captureEffect, /if \(markingSelectionPieces\.length === 0\) \{\s*setSelectionCapture\(null\);\s*return;/);
  assert.match(captureEffect, /captureConnectionSelection\([\s\S]{0,100}markingSelectionPieces/);
  assert.match(markingSelection, /if \(!showHighlightPalette\) return null/);
});

test("dismissing connection focus preserves held comparisons and refresh preserves an intentional null", () => {
  const reconciliation = sourceBetween(
    page,
    "// queryRange is authoritative",
    "  const releaseHeldConnection",
  );
  const release = sourceBetween(
    page,
    "const releaseHeldConnection = useCallback",
    "  const handleSelectConnection",
  );
  const dismiss = sourceBetween(
    page,
    "const handleDismissConnectionFocus = useCallback",
    "  const selectStudyScope",
  );

  assert.match(reconciliation, /setSelectedConnectionId\(\(current\) => \(\s*current == null\s*\? null/);
  assert.match(reconciliation, /next\.includes\(current\) \? current : \(next\.at\(-1\) \?\? null\)/);
  assert.match(release, /replaceHeldConnectionIds\(next\)/);
  assert.match(dismiss, /setSelectedConnectionId\(null\)/);
  assert.doesNotMatch(dismiss, /replaceHeldConnectionIds|releaseHeldConnection/);
  assert.match(underlay, /visiblePainted\.filter\(\(item\) =>\s*selectedConnectionId != null\s*&& isDurablePaintRecord/,
    "held comparisons may retain quiet word presence, but no line artifact may render without a selected connection");
});

test("the selected route toggles focus off without releasing the hold", () => {
  const routeHit = sourceBetween(
    underlay,
    "className=\"connection-route-hit\"",
    "              {focused && item.valid && item.contacts.map",
  );

  assert.match(routeHit, /if \(!isDurablePaintRecord\(item\.connection\)\) return/);
  assert.match(routeHit, /onDismissFocus\(\)/);
  assert.doesNotMatch(routeHit, /onSelectConnection\(null\)/);
  assert.doesNotMatch(routeHit, /releaseHeldConnection|onRelease/);
});

test("ConnectionCard Escape dismisses focus while the explicit Release action removes the hold", () => {
  const escapeHandler = sourceBetween(
    card,
    "const handleEscape = (event: KeyboardEvent)",
    "  const runUpdate",
  );
  const releaseAction = sourceBetween(
    card,
    "onClick={() => { if (!mutationLocked) onClose(true); }}",
    ">Release</button>",
  );

  assert.match(escapeHandler, /onDismiss\(true\)/);
  assert.doesNotMatch(escapeHandler, /onClose\(/);
  assert.match(releaseAction, /onClose\(true\)/);
  assert.doesNotMatch(releaseAction, /onDismiss\(/);
});

test("reading-canvas pointer activation keeps reading focus while authored-list activation enters Study", () => {
  assert.match(underlay, /onSelectConnection\(item\.connection\.durableRecord, event\.detail === 0\)/);
  assert.doesNotMatch(underlay, /onSelectConnection\(selected \? null : item\.connection\.durableRecord/);
  assert.match(page, /if \(focusInspector\) \{\s*setConnectionInspectorFocusRequest/);
  assert.match(page, /connectionInspectorFocusRequest=\{connectionInspectorFocusRequest\}/);
  assert.match(margin, /onClick=\{\(\) => onSelectAuthoredConnection\?\.\(connection, true\)\}/);
  assert.doesNotMatch(margin, /onSelectAuthoredConnection\?\.\(connection, event\.detail === 0\)/);
  const verseClick = sourceBetween(
    page,
    "const handleVerseClick = useCallback",
    "  const handleVerseKeyDown",
  );
  assert.match(verseClick, /handleSelectConnection\(ordered\[0\]!\.connection\)/);
  assert.doesNotMatch(verseClick, /handleSelectConnection\(ordered\[0\]!\.connection, true\)/);
  const requestedFocusEffect = sourceBetween(
    margin,
    "const lastConnectionInspectorFocusRequestRef",
    "  const activateTab",
  );
  assert.match(requestedFocusEffect, /if \(lastConnectionInspectorFocusRequestRef\.current === connectionInspectorFocusRequest\) return;/,
    "opening an inspector without an authored-list focus request must preserve reading focus");
  assert.match(requestedFocusEffect, /if \(!connectionInspectorOpen\) return;/);
  assert.match(requestedFocusEffect, /frameTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("outside clicks dismiss only connection focus and overlapping exact hits have a neutral chooser", () => {
  const outsideClick = sourceBetween(
    page,
    "const handleOutsideClick = (event: MouseEvent)",
    "  const handleCreateConnection",
  );
  const chooser = sourceBetween(
    page,
    "{connectionWordChooser && (",
    "      {marginVisible && !focusMode && (",
  );
  const closeChooser = sourceBetween(
    page,
    "const closeConnectionWordChooser = useCallback",
    "  useEffect(() => () => {",
  );

  assert.match(outsideClick, /event\.defaultPrevented \|\| event\.button !== 0/);
  for (const protectedSelector of [
    ".verse-line",
    ".connection-card",
    ".connection-route-hit",
    "[data-connection-tick]",
    ".connection-word-chooser",
    ".marking-floating-host",
    "[data-floating-layer]",
    ".popover-scrim",
  ]) {
    assert.ok(outsideClick.includes(`"${protectedSelector}"`), `missing outside-click exclusion: ${protectedSelector}`);
  }
  assert.match(outsideClick, /handleDismissConnectionFocus\(\)/);
  assert.match(outsideClick, /document\.addEventListener\("click", handleOutsideClick\)/);
  assert.doesNotMatch(outsideClick, /releaseHeldConnection|replaceHeldConnectionIds/);

  assert.match(chooser, /<Popover[\s\S]{0,420}className="connection-word-chooser"/);
  assert.match(chooser, /ariaLabel="Connections at these words"/);
  assert.match(chooser, /modal/);
  assert.match(chooser, /initialFocusRef=\{connectionWordChooserFirstChoiceRef\}/);
  assert.match(chooser, /maxHeight=\{520\}/);
  assert.match(chooser, /boundaryRect=\{stageBounds\}/);
  assert.match(chooser, /onClose=\{\(\) => closeConnectionWordChooser\(true\)\}/);
  assert.match(chooser, /connectionWordChooser\.hits\.map\(\(hit, index\)/);
  assert.match(chooser, /ref=\{index === 0 \? connectionWordChooserFirstChoiceRef : undefined\}/);
  assert.match(chooser, /event\.detail === 0/);
  assert.doesNotMatch(chooser, /closeConnectionWordChooser\(!focusInspector\)/);
  assert.match(chooser, /void handleSelectConnection\(hit\.connection, focusInspector\)/);
  assert.match(page, /handleConnectionWordChooserKeyDown[\s\S]{0,1800}event\.key === "ArrowDown"[\s\S]{0,500}event\.key === "ArrowUp"[\s\S]{0,500}event\.key === "Home"[\s\S]{0,240}event\.key === "End"/);
  assert.match(page, /target\?\.focus\(\{ preventScroll: true \}\)[\s\S]{0,160}target\?\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.match(page, /event\.key !== "Enter" && event\.key !== " "[\s\S]{0,520}activeChoice\.click\(\)/);
  assert.match(closeChooser, /setConnectionWordChooser\(null\)/);
  assert.doesNotMatch(closeChooser, /closeConnectionWordChooser\(/);
  assert.match(css, /\.connection-word-chooser\s*\{[\s\S]{0,220}grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.connection-word-choices\s*\{[\s\S]{0,220}overflow-y: auto/);
  assert.match(css, /@media \(any-pointer: coarse\), \(max-width: 640px\) \{[\s\S]{0,160}\.connection-word-chooser-head button \{ min-height: 44px; \}/);
  assert.doesNotMatch(css, /\.popover-panel\.connection-word-chooser\s*\{[\s\S]{0,240}inset:/);
});

test("stale connection projections and chooser rows cannot resurrect a removed durable id", () => {
  const selection = sourceBetween(
    page,
    "const handleSelectConnection = useCallback",
    "  /**\n   * Hide the visible relationship shape",
  );
  const chooserReconciliation = sourceBetween(
    page,
    "// The chooser is a transient projection of the current query",
    "  const releaseHeldConnection",
  );

  assert.match(page, /visibleConnectionByIdRef\.current = visibleConnectionById/);
  assert.match(selection, /visibleConnectionByIdRef\.current\.get\(connection\.id\)/);
  assert.match(selection, /if \(connection != null && visibleConnection == null\) \{[\s\S]{0,120}return false;/);
  assert.ok(
    selection.indexOf("await requestScriptureWorkspaceAttention()")
      < selection.lastIndexOf("closeConnectionWordChooser(false)"),
    "the chooser must remain unchanged until Scripture attention is approved",
  );
  assert.match(selection, /replaceHeldConnectionIds\(\[\.\.\.heldConnectionIdsRef\.current, visibleConnection\.id\]\)/);
  assert.match(chooserReconciliation, /visibleConnectionById\.get\(hit\.connection\.id\)/);
  assert.match(chooserReconciliation, /if \(hits\.length === 0\) \{[\s\S]{0,120}closeConnectionWordChooser\(false\)/);
});

test("translation changes close point-anchored chooser state before prose reflows", () => {
  const packageReset = sourceBetween(
    page,
    "// Phrase offsets and highlight animations belong to one translation's text",
    '  return (\n    <div className="scripture-page">',
  );
  assert.match(packageReset, /closeConnectionWordChooser\(false\)/);
  assert.match(packageReset, /\[[^\]]*closeConnectionWordChooser[^\]]*packageId[^\]]*sessionOwnerTabId[^\]]*\]/,
    "package cleanup must rerun for the exact owner as well as the translation");
});

test("connection-card query refreshes preserve dirty fields and blank titles reset on blur", () => {
  const recordSync = sourceBetween(
    card,
    "const updateOwnsCurrentVersion",
    "  const resetDraftTitle",
  );
  const titleSave = sourceBetween(card, "const saveLabel", "  const saveObservation");

  assert.match(card, /const adoptedTitleRef = useRef\(originalTitle\)/);
  assert.match(card, /const adoptedObservationRef = useRef\(currentObservation\)/);
  assert.match(recordSync, /const titleIsDirty = draftLabelRef\.current !== adoptedTitleRef\.current/);
  assert.match(recordSync, /const observationIsDirty = draftObservationRef\.current !== adoptedObservationRef\.current/);
  assert.match(recordSync, /if \(!titleIsDirty\) setDraftLabel\(nextTitle\)/);
  assert.match(recordSync, /if \(!observationIsDirty\) setDraftObservation\(nextObservation\)/);
  assert.match(titleSave, /if \(!visibleLabel\) \{\s*resetDraftTitle\(\);/);
  assert.match(card, /const labelChanged = draftLabel !== originalTitle/);
  assert.match(card, /onBlur=\{\(\) => \{ if \(labelChanged\) void saveLabel\(\); \}\}/);
});

test("dirty connection-card deletion saves one combined authored version before arming", () => {
  const deletion = sourceBetween(card, "const confirmDelete", "  const retryPendingMutation");
  assert.match(deletion, /const next = \{ \.\.\.connection, label, observation: draftObservation \}/);
  assert.match(deletion, /armDeleteAfterFingerprintRef\.current = fingerprint/);
  assert.match(deletion, /await runUpdate\(pendingCommand\)/);
  assert.doesNotMatch(deletion, /await saveLabel\(\)|await saveObservation\(\)/);
});

test("every dialog Escape handler consults the shared top-layer owner", () => {
  for (const source of [commandPalette, noteCapture, shortcuts, structure]) {
    assert.match(source, /isTopLayer\(layerRef\.current\)/);
  }
  assert.match(margin, /if \(!layerStackIsEmpty\(\)\) return/);
});

test("Escape is owned by the topmost floating layer before Focus mode", () => {
  const hiddenCardFallback = sourceBetween(
    page,
    "// The card normally owns a local Escape ladder",
    "  const handleConnectionWordChooserKeyDown",
  );
  assert.match(app, /if \(e\.defaultPrevented\) return/);
  // One shared layer registry owns every dismiss gesture; DOM heuristics are gone.
  assert.match(app, /if \(e\.key === "Escape" && focusMode\) \{[\s\S]{0,300}layerStackIsEmpty\(\)[\s\S]{0,160}return/);
  assert.match(hiddenCardFallback, /isTopLayer\(connectionFocusFallbackLayerRef\.current\)/);
  assert.match(hiddenCardFallback, /if \(!selectedConnectionIdRef\.current\) return/);
  assert.match(page, /selectedConnectionIdRef\.current = null;\s*setSelectedConnectionId\(null\)/,
    "shape dismissal must synchronously yield the next Escape before React effect cleanup");
  assert.match(hiddenCardFallback, /event\.preventDefault\(\);[\s\S]{0,120}event\.stopImmediatePropagation\(\);[\s\S]{0,120}handleDismissConnectionFocus\(true\)/);
  assert.match(hiddenCardFallback, /window\.addEventListener\("keydown", handleSelectedConnectionEscape, true\)/);
  const legacyPaletteFallback = sourceBetween(page, "// Escape dismisses palette chrome", "// Browser-style canvas history");
  assert.match(legacyPaletteFallback, /if \(focusMode\) return/,
    "unmounted palette state must yield the second Escape to Focus mode");
  assert.match(legacyPaletteFallback, /layerStackIsEmpty\(\)/,
    "legacy palette fallback owns Escape only when no layer is registered");
  assert.match(markingSurface, /if \(focusMode\) return/,
    "hidden Smart Shapes chrome must yield Escape to Focus mode");
  assert.match(markingSurface, /isTopLayer\(layerRef\.current\)/,
    "marking surfaces defer to the shared layer registry");
  assert.match(page, /<MarkingSurface[\s\S]{0,220}focusMode=\{focusMode\}/,
    "Scripture must tell the marking controller when its chrome is hidden");
  assert.match(underlay, /if \(focusMode \|\| previewConnectionId == null \|\| selectedConnectionId != null\) return undefined/,
    "an underlay hover preview cannot take Focus mode's second Escape");
  assert.match(page, /<ConnectionUnderlay[\s\S]{0,900}focusMode=\{focusMode\}/,
    "Scripture must tell its connection underlay when Focus mode owns Escape");
  const markingDismiss = sourceBetween(page, "const handleDismissMarkingSurface", "  const replaceHeldConnectionIds");
  assert.match(markingDismiss, /setShowHighlightPalette\(false\);[\s\S]{0,300}window\.getSelection\(\)\?\.removeAllRanges\(\)/,
    "dismissing marking must release the native Range before the next connected-word click");
});

test("Enter and Space select Study while M deliberately opens whole-verse marking", () => {
  const keyHandler = sourceBetween(
    page,
    "const handleVerseKeyDown = useCallback",
    "  // Connection focus is a temporary reading lens",
  );

  assert.match(keyHandler, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(keyHandler, /positionPalette\(next\)/);
  assert.match(keyHandler, /setShowHighlightPalette\(true\)/);
  assert.match(keyHandler, /if \(event\.key !== "Enter" && event\.key !== " "\) return/);
  assert.match(keyHandler, /selectStudyScope\(verse, event\.shiftKey\)/);
  assert.match(page, /aria-keyshortcuts="Enter Space M"/);
});

test("plain reading arrows traverse chapters while Tab and Shift-Tab cycle Living Margin lenses", () => {
  const chapterKeys = sourceBetween(
    page,
    "// Keyboard navigation: prev/next chapter",
    "  // The marking surfaces are sized",
  );
  const globalLensKeys = sourceBetween(
    margin,
    "const cycleStudyLens = (event: KeyboardEvent)",
    "    window.addEventListener(\"keydown\", cycleStudyLens",
  );

  assert.match(chapterKeys, /const plainReadingArrow = [\s\S]{0,240}target\?\.closest\("\.verse-line"\)/);
  assert.match(chapterKeys, /\(plainReadingArrow \|\| appArrow\) && e\.key === "ArrowLeft"/);
  assert.match(chapterKeys, /goTo\(book, chapter - 1, undefined, \{ recordRecent: false \}\)/);
  assert.match(chapterKeys, /\(plainReadingArrow \|\| appArrow\) && e\.key === "ArrowRight"/);
  assert.match(chapterKeys, /goTo\(book, chapter \+ 1, undefined, \{ recordRecent: false \}\)/);

  assert.match(globalLensKeys, /if \(event\.key !== "Tab"\) return/);
  assert.match(globalLensKeys, /const reverse = event\.shiftKey/);
  assert.doesNotMatch(globalLensKeys, /ArrowLeft|ArrowRight/);
});

test("the permanent interaction gate encodes dense chooser fit and exact outside-release capture", () => {
  assert.match(readingQa, /const VIEWPORTS = \[390, 860\]/);
  assert.match(readingQa, /id: "palette"[\s\S]{0,420}id: "rail"[\s\S]{0,420}id: "radial"[\s\S]{0,420}id: "dock"/);
  assert.match(readingQa, /for \(let index = 0; index < 12; index \+= 1\)/);
  assert.match(readingQa, /const denseKinds = \["link:parallel", "link:contrast", "link:echo", "mirror", "series", "hinge"\]/);
  assert.doesNotMatch(readingQa, /"link:(?:mirror|series|hinge)"/);
  assert.match(readingQa, /const closedThreeWordPhrase = async \(verse\)/);
  assert.match(readingQa, /!sharesOccurrence\(anchor, before\)[\s\S]*!sharesOccurrence\(anchor, after\)/);
  assert.match(readingQa, /window\.api\.library\.projectConnections\("bsb", denseProjectionRequests\)/);
  assert.match(readingQa, /fragment\.char_start !== spec\.charStart[\s\S]*fragment\.char_end !== spec\.charEnd[\s\S]*fragment\.quote !== spec\.quote/);
  assert.match(readingQa, /listScrollHeight > state\.chooserGeometry\.listClientHeight/);
  assert.match(readingQa, /assert\.equal\(point\.ownsPoint, true, `\$\{selector\}: dispatched point is owned by \$\{point\.owner\}`\)/);
  assert.match(readingQa, /assert\.equal\(point\.ownsSpan, true, `\$\{spec\.verse\}:\$\{spec\.quote\}: phrase point is owned by \$\{point\.owner\}`\)/);
  assert.match(readingQa, /startOwnsSpan: ownsSpan\(start\)[\s\S]*endOwnsSpan: ownsSpan\(end\)/);
  assert.match(readingQa, /!document\.elementFromPoint\(point\.x, point\.y\)\?\.closest\("\.verse-text"\)/);
  assert.match(readingQa, /choice\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)[\s\S]*owner === choice \|\| choice\.contains\(owner\)/);
  assert.match(readingQa, /action\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)[\s\S]*owner === action \|\| action\.contains\(owner\)/);
  assert.match(readingQa, /paneGeometry\.overlapX <= 0\.75 \|\| paneGeometry\.overlapY <= 0\.75/);
  assert.match(readingQa, /if \(width === 390\)[\s\S]*paneGeometry\.stage\.width >= 300[\s\S]*paneGeometry\.stage\.height >= 300[\s\S]*paneGeometry\.margin\.width >= 300[\s\S]*paneGeometry\.margin\.height >= 300/);
  assert.match(readingQa, /capturedDragQuote, dragSelection\.replace\(\/\\s\+\/g, " "\)\.trim\(\)/);
  assert.match(readingQa, /assertLedgerUnchanged\(annotationsRoot, ledgerBaseline/);
});

test("the permanent interaction gate proves coarse dense-tick overflow through the real chooser", () => {
  const coarseGate = sourceBetween(
    readingQa,
    "async function runCoarseDenseTickOverflowGate",
    "async function runInteractionCell",
  );
  const readiness = sourceBetween(
    readingQa,
    "async function ensureCellReady",
    "async function runCoarseDenseTickOverflowGate",
  );

  assert.doesNotMatch(readingQa, /COARSE_TICK_RAIL_HEIGHT|data-qa-coarse-tick-rail/);
  assert.match(coarseGate, /ensureCellReady\(driver, cdp, SURFACES\[0\], 860, fixture\)/);
  assert.match(readiness, /querySelectorAll\("\[data-connection-tick-side\]"\)[\s\S]{0,420}data-connection-tick-members[\s\S]{0,320}represented\.length === \$\{fixture\.connectionCount\}[\s\S]{0,120}new Set\(represented\)\.size === \$\{fixture\.connectionCount\}/);
  assert.match(readingQa, /const denseCounterpartFixture = await closedThreeWordPhrase\(14\)[\s\S]{0,900}\[denseAnchor, denseCounterpartFixture\.anchor\]/);
  assert.equal(
    [...readingQa.matchAll(/await runCoarseDenseTickOverflowGate\(driver, cdp, fixture, annotationsRoot, ledgerBaseline\)/g)].length,
    1,
    "the permanent coarse gate must be invoked exactly once",
  );
  assert.match(readingQa, /phase: "coarse-dense-tick-overflow"[\s\S]{0,180}await runCoarseDenseTickOverflowGate[\s\S]{0,180}phase: "renderer-diagnostics"/);
  assert.match(coarseGate, /Emulation\.setTouchEmulationEnabled", \{ enabled: true, maxTouchPoints: 1 \}/);
  assert.match(coarseGate, /driver\.evaluate\(`matchMedia\("\(any-pointer: coarse\)"\)\.matches`\)[\s\S]{0,120}true,[\s\S]{0,140}CDP touch emulation did not expose any-pointer coarse/);
  assert.match(coarseGate, /production[\s\S]{0,120}collision planner[\s\S]{0,520}new Set\(\$\{JSON\.stringify\(denseExpectedIds\)\}\)/);
  assert.match(coarseGate, /tickReport\.underlay\.height > 0/);

  assert.match(coarseGate, /querySelectorAll\("\[data-connection-tick-side\]"\)/);
  assert.match(coarseGate, /hasAttribute\("data-connection-tick-aggregate"\)/);
  assert.match(coarseGate, /getAttribute\("data-connection-tick-members"\)/);
  assert.match(coarseGate, /getAttribute\("data-connection-tick"\)/);
  assert.match(coarseGate, /getComputedStyle\(button, "::before"\)[\s\S]{0,180}Number\.parseFloat\(before\.top\)[\s\S]{0,120}Number\.parseFloat\(before\.bottom\)/);
  assert.match(coarseGate, /viewportHitTop = rect\.top \+ beforeTop[\s\S]{0,120}viewportHitBottom = rect\.bottom - beforeBottom/);
  assert.match(coarseGate, /hitTop = viewportHitTop - underlayRect\.top[\s\S]{0,120}hitBottom = viewportHitBottom - underlayRect\.top/);
  assert.match(coarseGate, /document\.elementFromPoint\(hitX, viewportHitTop \+ 1\.5\)[\s\S]{0,140}document\.elementFromPoint\(hitX, viewportHitBottom - 1\.5\)/);
  assert.match(coarseGate, /button\.scrollIntoView\(\{ block: "center", inline: "nearest" \}\)/);
  assert.match(coarseGate, /control\.beforePosition, "absolute"/);
  assert.match(coarseGate, /control\.topOwnsHit, true/);
  assert.match(coarseGate, /control\.bottomOwnsHit, true/);
  assert.match(coarseGate, /control\.hitTop >= -GEOMETRY_EPSILON[\s\S]{0,180}control\.hitBottom <= control\.underlayHeight/);
  assert.match(coarseGate, /intervals\[index\]\.hitTop >= intervals\[index - 1\]\.hitBottom - GEOMETRY_EPSILON/);
  assert.match(coarseGate, /new Set\(representedIds\)\.size, representedIds\.length/);
  assert.match(coarseGate, /\[\.\.\.representedIds\]\.sort\(\), expectedIds/);
  assert.match(coarseGate, /tickReport\.selectedControls, 0[\s\S]{0,420}tickReport\.pressedControls, 0[\s\S]{0,420}tickReport\.routes, 0[\s\S]{0,420}tickReport\.cards, 0/);

  assert.match(coarseGate, /denseAggregateControls = tickReport\.controls[\s\S]{0,700}new Set\(denseAggregateIds\)\.size, denseAggregateIds\.length/);
  assert.match(coarseGate, /\[\.\.\.denseAggregateIds\]\.sort\(\), denseExpectedIds/);
  assert.match(coarseGate, /every\(\(control\) => control\.aggregate\)/);
  assert.match(coarseGate, /const aggregate = denseAggregateControls\[0\]/);
  assert.match(coarseGate, /aggregatePoint = await driver\.evaluate/);
  assert.match(coarseGate, /ownsPoint: owner === element \|\| element\.contains\(owner\)/);
  assert.match(coarseGate, /chooserReport\.ids, aggregate\.memberIds[\s\S]{0,900}chooserReport\.selectedControls, 0[\s\S]{0,500}chooserReport\.pressedControls, 0/);
  assert.match(coarseGate, /chooserReport\.expandedGroups, 1[\s\S]{0,280}chooserReport\.expandedGroupControls, "connection-word-chooser"/);
  assert.match(coarseGate, /selectedTickSelector[\s\S]{0,420}getAttribute\("aria-pressed"\) === "true"[\s\S]{0,260}getAttribute\("aria-expanded"\) === "false"[\s\S]{0,260}!document\.querySelector\("\.connection-word-chooser"\)/);
  assert.match(coarseGate, /assert\.equal\(selectedReport\.held, true/);
  assert.match(coarseGate, /assert\.equal\(selectedReport\.choosers, 0/);
  assert.match(coarseGate, /assert\.equal\(selectedReport\.routeOwnerId, chosen\.id/);
  assert.match(coarseGate, /selectedReport\.chooserExpanded, false/);
  assert.match(coarseGate, /heldIds: \[\.\.\.document\.querySelectorAll\("\[data-held-connection-ids\]"\)\][\s\S]{0,180}JSON\.parse/);
  assert.match(coarseGate, /assert\.deepEqual\(selectedReport\.heldIds, \[chosen\.id\]/);
  assert.match(coarseGate, /clickCardAction\(driver, cdp, "Release"\)[\s\S]{0,520}!document\.querySelector\("\[data-held-connection-ids\]"\)[\s\S]{0,180}assertLedgerUnchanged\(annotationsRoot, ledgerBaseline, label\)/);

  const cleanup = sourceBetween(coarseGate, "  } finally {", "\n  }\n}");
  assert.match(cleanup, /setTouchEmulationEnabled", \{ enabled: false, maxTouchPoints: 1 \}/);
  assert.match(cleanup, /setViewport\(cdp, baselineEnvironment\.viewport\.width, baselineEnvironment\.viewport\.height\)/);
  assert.match(cleanup, /restoredEnvironment\.coarse, baselineEnvironment\.coarse/);
  assert.match(cleanup, /restoredEnvironment\.viewport, baselineEnvironment\.viewport/);
});

test("the permanent interaction harness rejects CDP protocol failures and waits for Electron cleanup", () => {
  const connection = sourceBetween(readingQa, "async function connect", "async function waitForTarget");
  assert.match(connection, /new Promise\(\(resolvePromise, reject\)/);
  assert.match(connection, /if \(message\.error\)[\s\S]{0,300}QA_CDP_PROTOCOL_ERROR[\s\S]{0,220}reject\(error\)/);

  const childExit = sourceBetween(readingQa, "async function waitForChildExit", "async function pressKey");
  assert.match(childExit, /timeoutMilliseconds = 2_500/);
  assert.match(childExit, /child\.once\("exit", finish\)/);
  assert.match(childExit, /setTimeout\(finish, timeoutMilliseconds\)/);
  assert.match(readingQa, /child\.kill\("SIGTERM"\)[\s\S]{0,180}await waitForChildExit\(child, childState\)/);
  assert.match(readingQa, /if \(childState\.exited\) \{\s*rmSync\(qaRoot/);
  assert.doesNotMatch(readingQa, /await sleep\(400\)/);
});

test("the permanent interaction gate exercises modal chooser keys and the ordered Escape ladders", () => {
  const matrix = sourceBetween(
    readingQa,
    "async function runInteractionCell",
    "function classifyFailure",
  );
  const report = sourceBetween(
    readingQa,
    "function interactionReportExpression",
    "function assertNoMarking",
  );
  const tickActivation = sourceBetween(
    readingQa,
    "async function activateConnectionTick",
    "async function clickCardAction",
  );

  assert.match(readingQa, /chooserModal: chooserPanel\?\.getAttribute\("aria-modal"\) === "true"/);
  assert.match(readingQa, /focusedChooserIndex = chooserChoices\.findIndex\(\(choice\) => choice === document\.activeElement\)/);
  assert.match(readingQa, /inspectorFocused: Boolean\(document\.activeElement\?\.closest\("\.living-margin"\)\)/);
  assert.match(readingQa, /focusMode: document\.querySelector\("\.app-shell"\)\?\.classList\.contains\("focus-mode"\) \?\? false/);
  assert.match(report, /querySelectorAll\("\[data-selected-connection-id\]"\)/);
  assert.match(report, /querySelectorAll\("\[data-held-connection-ids\]"\)[\s\S]{0,180}JSON\.parse/);

  assert.match(tickActivation, /getAttribute\("data-connection-tick"\) === connectionId/);
  assert.match(tickActivation, /JSON\.parse\(candidate\.getAttribute\("data-connection-tick-members"\) \?\? "\[\]"\)\.includes\(connectionId\)/);
  assert.match(tickActivation, /if \(!target\.aggregate\) return;[\s\S]{0,220}connection-word-choice\[data-connection-id/);
  assert.ok(
    [...matrix.matchAll(/await activateConnectionTick\(driver, cdp, denseKeyboardTarget\.id\)/g)].length >= 2,
    "the interaction matrix must reselect a possibly grouped dense relationship through the shared helper",
  );
  assert.match(matrix, /await activateConnectionTick\(driver, cdp, fixture\.alphaId\)/);
  assert.doesNotMatch(matrix, /\[data-connection-tick=/);
  assert.equal(matrix.includes('[data-connection-tick][aria-expanded="true"]'), false);
  assert.ok(
    [...matrix.matchAll(/!document\.querySelector\("\[data-selected-connection-id\]"\)/g)].length >= 3,
    "zero-selection waits must use semantic selected ownership instead of chooser expansion",
  );

  assert.match(matrix, /getAttribute\("aria-modal"\) === "true"[\s\S]{0,180}document\.activeElement === document\.querySelector\("\.connection-word-choice"\)/);
  assert.match(matrix, /await pressKey\(cdp, "End", "End"\)[\s\S]{0,520}await pressKey\(cdp, "ArrowUp", "ArrowUp"\)[\s\S]{0,420}await pressKey\(cdp, "Home", "Home"\)[\s\S]{0,360}await pressKey\(cdp, "ArrowDown", "ArrowDown"\)/);
  assert.match(matrix, /dense-chooser-escape[\s\S]{0,900}assertLedgerUnchanged\(annotationsRoot, ledgerBaseline, `\$\{label\}\/dense-chooser-escape`\)/);
  assert.match(matrix, /const denseKeyboardTarget[\s\S]{0,700}await pressKey\(cdp, "End", "End"\)[\s\S]{0,420}await pressKey\(cdp, "Enter", "Enter"\)[\s\S]{0,720}state\.inspectorFocused/);

  assert.match(matrix, /chooser-over-selected[\s\S]{0,700}await pressKey\(cdp, "Escape", "Escape"\)[\s\S]{0,700}chooser-first-escape[\s\S]{0,200}await pressKey\(cdp, "Escape", "Escape"\)[\s\S]{0,700}chooser-second-escape/);
  assert.match(matrix, /await pressKey\(cdp, "f", "KeyF"\)[\s\S]{0,900}await pressKey\(cdp, "Escape", "Escape"\)[\s\S]{0,900}focus-first-escape[\s\S]{0,320}await pressKey\(cdp, "Escape", "Escape"\)[\s\S]{0,900}focus-second-escape/);
  assert.match(matrix, /Release remains a separate explicit action after both dismissal ladders[\s\S]{0,520}clickCardAction\(driver, cdp, "Release"\)/);
  assert.match(matrix, /clickCardAction\(driver, cdp, "Release"\)[\s\S]{0,260}!document\.querySelector\("\[data-held-connection-ids\]"\)/);
});
