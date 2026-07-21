import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { ConnectionRecord } from "../src/core/annotations/types.js";
import {
  connectionLayoutSignature,
  orderActiveConnections,
  orderConnectionTicks,
} from "../src/renderer/components/ConnectionUnderlay.js";
import {
  CONNECTION_ROUTE_QUIET_STROKE,
  CONNECTION_ROUTE_SELECTED_STROKE,
  CONNECTION_UNDERLINE_CENTER_OFFSET,
  CONNECTION_UNDERLINE_QUIET_STROKE,
  CONNECTION_UNDERLINE_SELECTED_STROKE,
  connectionUnderlineCenter,
  connectionUnderlineDy,
} from "../src/renderer/utils/connectionGeometry.js";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf8");

test("all four production marking surfaces share one explicit mutation controller", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  for (const surface of ["palette", "radial", "rail"] as const) {
    assert.match(source, new RegExp(`surface === "${surface}"`));
  }
  assert.match(source, /data-marking-surface="dock"/);
  assert.match(source, /onSetColor: \(color: string\) => Promise<boolean>/);
  assert.match(source, /onCreateConnection:/);
  assert.match(source, /onUpdateConnection:/);
  assert.match(source, /onRemove: \(\) => Promise<boolean>/);
  assert.match(source, /onNote: \(\) => void/);
  assert.equal(
    [...source.matchAll(/if \(ok\) onClearSelection\(current\.nonce\);/g)].length,
    2,
    "successful highlight and erase writes must consume only their owned native selection",
  );

  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  assert.match(page, /const handleClearMarginSelection = useCallback\(\(expectedNonce\?: number\) => \{\s*if \(expectedNonce != null && selectionGenerationRef\.current !== expectedNonce\) return;\s*window\.getSelection\(\)\?\.removeAllRanges\(\);/);
  assert.match(page, /const scheduleVerseFocus = useCallback\(\(targetVerse: number, expectedNonce\?: number\)[\s\S]*selectionGenerationRef\.current !== expectedNonce/);
  assert.match(page, /const restoreMarkingSelection = \(snapshot: MarkingSelectionSnapshot\)[\s\S]*window\.cancelAnimationFrame\(readingFocusFrameRef\.current\);[\s\S]*setPhraseSelection/);

  const vocabulary = read("src", "renderer", "utils", "relationshipVocabulary.ts");
  assert.match(source, /RELATIONSHIPS/);
  for (const kind of ["link:parallel", "link:contrast", "link:echo", "mirror", "series", "hinge"] as const) {
    assert.ok(vocabulary.includes(`id: "${kind}"`), `missing relationship kind ${kind}`);
  }
});

test("relationship extension preserves the existing identity and tray opening does not consume a selection", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(
    source,
    /const next: ConnectionSession = \{\s*\.\.\.base,\s*anchors:/,
    "adding words must retain the existing connectionId and label from the seeded session",
  );
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => \{ setTool\(\{ type: "wash", color: currentWash \?\? "yellow" \}\); setTray/,
    "opening the persistent wash tray must wait for the user to choose a pigment",
  );
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => \{ setTool\(\{ type: "connect", kind: currentKind \?\? "link:parallel" \}\); setTray/,
    "opening the persistent connection tray must wait for the user to choose a relationship",
  );
});

test("reading canvas mounts routed connections, one shared margin inspector, and stage-responsive surfaces", () => {
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const styles = read("src", "renderer", "styles.css");

  assert.match(page, /<ConnectionUnderlay/);
  assert.match(page, /<ConnectionCard/);
  assert.match(page, /connectionInspector=\{selectedConnection \? \(/);
  const stageStart = page.indexOf('className="scripture-reading-stage"');
  const marginStart = page.indexOf("<LivingMargin", stageStart);
  const inspectorStart = page.indexOf("<ConnectionCard", marginStart);
  assert.ok(stageStart >= 0 && marginStart > stageStart && inspectorStart > marginStart);
  assert.doesNotMatch(page.slice(stageStart, marginStart), /<ConnectionCard/);
  assert.match(page, /<MarkingSurface/);
  assert.match(page, /className="scripture-reading-stage" ref=\{stageRef\}/);
  assert.match(styles, /container:\s*reading-stage\s*\/\s*inline-size/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\]/);
  assert.match(styles, /--mark-stage-width/);
  assert.match(styles, /\.marking-radial-scrim/);
  assert.match(styles, /\.marking-dock-host/);
  assert.match(styles, /\.marking-rail-host/);
  assert.match(page, /anchorBox: \{ \.\.\.box \},[\s\S]*focusBox: \{ \.\.\.focusBox \},[\s\S]*proseBox/);
  assert.match(page, /const proseRect = verseTextRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(page, /document\.fonts\?\.addEventListener\("loadingdone", schedule\)/);
  assert.doesNotMatch(page, /HALF_WIDTH_ESTIMATE|SURFACE_HEIGHT_ESTIMATE/);
});

test("held authored connections use the quiet typeset Living Margin card", () => {
  const app = read("src", "renderer", "app.tsx");
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const margin = read("src", "renderer", "components", "LivingMargin.tsx");
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");
  const underlay = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const styles = read("src", "renderer", "styles.css");

  assert.match(app, /const ensureMarginVisible = useCallback\(\(\) => \{[\s\S]*setFocusMode\(false\);[\s\S]*setMarginVisible\(true\);/);
  assert.match(app, /onEnsureMarginVisible=\{ensureMarginVisible\}/);
  assert.match(page, /const \[heldConnectionIds, setHeldConnectionIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(page, /const heldConnectionIdsRef = useRef<string\[\]>\(\[\]\)/);
  assert.match(page, /const available = new Set\(visibleMarginData\.connections\.map[\s\S]*heldConnectionIdsRef\.current = next[\s\S]*current == null[\s\S]*\? null[\s\S]*next\.includes\(current\)/,
    "refresh reconciliation must preserve an intentional dismissed focus instead of waking the last held route");
  assert.match(page, /const releaseHeldConnection = useCallback[\s\S]*filter\(\(candidate\) => candidate !== connectionId\)[\s\S]*next\.at\(-1\) \?\? null/);
  assert.match(page, /setSelectedConnectionId\(\(current\) => \([\s\S]*current === connectionId \? \(next\.at\(-1\) \?\? null\) : current/);
  assert.match(page, /const handleSelectConnection = useCallback\(\([\s\S]{0,180}connection: ConnectionRecord \| null,[\s\S]*visibleConnectionByIdRef\.current\.get\(connection\.id\)[\s\S]*replaceHeldConnectionIds\(\[\.\.\.heldConnectionIdsRef\.current, visibleConnection\.id\]\)[\s\S]*onCloseEntity\?\.\(\);[\s\S]*onEnsureMarginVisible\?\.\(\);/);
  assert.match(page, /const handleSelectConnection = useCallback[\s\S]*advanceSelectionGeneration\(\)/);
  assert.match(page, /onSelectConnection=\{handleSelectConnection\}/);
  assert.match(page, /heldConnectionIds=\{visibleHeldConnectionIds\}/);
  assert.match(page, /otherHeldCount=\{Math\.max\(0, visibleHeldConnectionIds\.length - 1\)\}/);
  assert.match(underlay, /className=\{`connection-mark[\s\S]*\$\{userHeld \? " user-held" : ""\}/);
  assert.match(underlay, /aria-pressed=\{userHeld\}/);
  assert.match(underlay, /role="toolbar"/);
  assert.match(underlay, /aria-orientation="vertical"/);
  assert.match(underlay, /tabIndex=\{effectiveRovingTickId === lane\.key \? 0 : -1\}/);
  assert.match(underlay, /data-connection-tick-members=\{aggregate \? encodeConnectionTickMemberIds\(lane\.memberIds\) : undefined\}/);
  assert.match(underlay, /aria-haspopup=\{aggregate \? "dialog" : undefined\}/);
  assert.match(underlay, /aria-expanded=\{aggregate \? aggregateExpanded : selected\}/);
  assert.match(underlay, /aggregateExpanded \? "connection-word-chooser" : undefined[\s\S]*selected \? "connection-card-inspector" : undefined/);
  assert.match(card, /id="connection-card-inspector"/);
  assert.match(card, /updateCommandRef/);
  assert.match(card, /connectionMutationFingerprint/);
  assert.match(card, /const connectionVersion = connectionMutationFingerprint\(connection\)/);
  assert.match(card, /afterFingerprint:[\s\S]*updateCommandRef\.current\?\.fingerprint/,
    "a rapid follow-up edit must wait for the exact authored payload it follows");
  assert.match(card, /queuedEditPending[\s\S]*mutationLocked = busy \|\| queuedEditPending/,
    "a queued card edit must keep local and shell navigation locked");
  assert.match(card, /void commit\(\{ \.\.\.visible, \.\.\.queued\.patch \}\)\.then\(\(owned\)[\s\S]*if \(!owned \|\| queuedCardEditRef\.current !== queued\) return;[\s\S]*queuedCardEditRef\.current = null/,
    "the coalesced edit must not be cleared before a command takes ownership");
  assert.match(app, /authoredMutationStateRef\.current !== "idle"[\s\S]*changeView/,
    "view changes must not unmount an authored mutation owner");
  assert.match(card, /const commandMustRemainReachable = requestInFlightRef\.current[\s\S]*ambiguousMutation != null[\s\S]*recovery != null/,
    "pending command reachability must survive same-content hydration");
  assert.match(card, /const onRecoveryChangeRef = useRef\(onRecoveryChange\)[\s\S]*onRecoveryChangeRef\.current = onRecoveryChange/);
  assert.match(card, /\}, \[ambiguousMutation, conflictReview, connection,[\s\S]*connection\.activeEventId, connectionVersion, recovery\]\);/,
    "same-content hydration and event-version changes must not erase a reachable pending Retry identity");
  assert.match(card, /deleteCommandRef\.current \?\?= \{[\s\S]*commandId: crypto\.randomUUID\(\),[\s\S]*expectedBaseEventId: connection\.activeEventId/);
  assert.match(card, /onUpdate\([\s\S]*pendingCommand\.next,[\s\S]*pendingCommand\.commandId,[\s\S]*pendingCommand\.expectedBaseEventId/,
    "an explicit retry must reuse the same update command identity");
  assert.match(card, /onDelete\([\s\S]*pendingCommand\.connection,[\s\S]*pendingCommand\.commandId,[\s\S]*pendingCommand\.expectedBaseEventId/,
    "an explicit retry must reuse the same delete command identity");
  assert.match(page, /const handleCloseConnection = useCallback[\s\S]*releaseHeldConnection\(connectionId, restoreFocus\)/);
  assert.match(page, /const focusLivingMarginHeading = useCallback[\s\S]*#living-margin-title[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /const handleDeleteConnection = useCallback[\s\S]*releaseHeldConnection\(connection\.id\);[\s\S]*focusLivingMarginHeading\(\)/);
  assert.match(page, /const marginRequestSequenceRef = useRef\(0\)/);
  assert.match(page, /requestSequence !== marginRequestSequenceRef\.current/,
    "reverse-completing same-chapter queries must not restore stale connection state");
  assert.match(page, /return \{ status: "superseded" \}[\s\S]*if \(!res\.ok\) return \{ status: "failed" \}/,
    "a superseded query must remain distinct even when its transport also fails");
  assert.match(page, /needsLocalConnectionReconciliation\(reload\.status, result\.value\)[\s\S]*reconcileCreatedConnection/,
    "a committed create must reconcile a failed or pending post-write query");
  assert.match(page, /needsLocalConnectionReconciliation\(reload\.status, result\.value\)[\s\S]*&& !isRecovery[\s\S]*reconcileCreatedConnection/,
    "a historical create Retry must never resurrect a newer tombstone from an absent read-model row");
  assert.match(page, /reconcileUpdatedConnection\([\s\S]*expectedBaseEventId/,
    "a committed update fallback must compare its initiating renderer version");
  assert.match(page, /result\.value\.conflict[\s\S]*const conflictReload = await reloadMarginHighlights\(\{[\s\S]*preserveConnection:[\s\S]*conflictReload\.status === "applied"[\s\S]*return "conflict"/,
    "an optimistic conflict must reload current authored state without becoming ambiguous Retry");
  assert.match(page, /!projectionPending[\s\S]*reload\.status !== "superseded"[\s\S]*reconcileDeletedConnection/,
    "a current committed delete may reconcile locally, while pending deletion stays retryable");
  assert.match(card, /data-pending-mutation=\{ambiguousMutation\?\.kind\}/);
  assert.match(card, /className="connection-card-retry"[\s\S]*retryPendingMutation/);
  assert.match(card, /const mutationLocked = busy \|\| queuedEditPending \|\| conflictReview != null \|\| ambiguousMutation != null/);
  assert.match(page, /const \[connectionCardRecovery, setConnectionCardRecovery\] = useState<ConnectionCardRecovery \| null>\(null\)/);
  assert.match(page, /if \(connectionCardRecovery\)[\s\S]*visibleVersion === connectionCardRecovery\.command\.expectedBaseEventId[\s\S]*connectionCardRecovery\.command\.next/,
    "card recovery must survive chapter hydration without replacing a genuinely newer entity version");
  assert.match(page, /recovery=\{connectionCardRecovery\}[\s\S]*handleConnectionCardRecoveryChange\(selectedConnection\.id, recovery\)/,
    "the stable pending command must live above a chapter-owned card mount");
  assert.match(card, /recovery\?\.kind === "update" \? recovery\.command : null/);
  assert.match(card, /requestInFlightRef\.current[\s\S]*\|\| ambiguousMutation != null[\s\S]*\|\| recovery != null/,
    "hydration and navigation must not orphan an in-flight or pending command");
  assert.match(card, /className="connection-card-observation"[\s\S]*<textarea[\s\S]*disabled=\{mutationLocked\}[\s\S]*saveObservation\(\)/,
    "an ambiguous whole-record mutation must lock the authored observation");
  assert.match(card, /disabled=\{mutationLocked\}[\s\S]*onJump\(anchor\)/,
    "navigation must not unmount a pending exact Retry");
  assert.match(card, /<section[\s\S]*aria-busy=\{busy\}/);
  assert.match(card, /otherHeldCount > 0 \? ` · \$\{otherHeldCount\}\\u00a0more\\u00a0held`/);
  assert.match(card, /data-dirty=\{observationChanged\}[\s\S]*placeholder="Why do these words belong together\?"[\s\S]*rows=\{1\}[\s\S]*Unsaved · blur or ⌘↵ to save/,
    "the durable observation editor must rest as one quiet line and reveal save state only while editing");
  assert.match(card, /connection\.format_version !== 2[\s\S]*deliberate exact-anchor replacement before editing/);
  assert.match(card, /isTopLayer\(layerRef\.current\)/);
  assert.match(
    card,
    /if \(deleteArmed\)[\s\S]*setDeleteArmed\(false\)[\s\S]*onDismiss\(true\)/,
    "Escape must cancel local card state before dismissing focus without releasing the held connection",
  );
  assert.match(card, /type MomentPosition = "above" \| "here" \| "below"/);
  assert.match(card, /locator\?\.package === packageId/);
  assert.match(card, /new MutationObserver\(scheduleMeasure\)/);
  assert.match(card, /fontSet\.addEventListener\("loadingdone", handleFontsLoaded\)/);
  assert.match(card, /\[anchors, book, chapter, packageId\]/);
  assert.match(page, /projectedQuote[\s\S]*anchor\.render_locator\?\.package === packageId[\s\S]*Exact wording unavailable in this translation/);
  assert.match(page, /<ConnectionCard[\s\S]*key=\{selectedConnection\.id\}/);
  assert.match(
    page,
    /const advanceSelectionGeneration = useCallback[\s\S]*cancelAnimationFrame\(readingFocusFrameRef\.current\)[\s\S]*setSelectionNonce\(next\)/,
    "a new marking selection must cancel the prior selection's deferred reading-focus return",
  );
  assert.match(
    page,
    /scheduleVerseFocus\(targetVerse, selectionGenerationRef\.current\)/,
    "dismissal focus may return only while its exact selection generation still owns the canvas",
  );
  assert.match(card, />Release<\/button>/);
  assert.match(
    card,
    /onClick=\{\(\) => \{ if \(!mutationLocked\) onClose\(true\); \}\}[\s\S]*>Release<\/button>/,
    "Release must remain the explicit held-state removal action",
  );
  assert.doesNotMatch(card, /connection-card-close|Close connection details/);
  assert.match(card, /autoComplete="off"/);
  assert.doesNotMatch(card, /autoFocus|\.focus\(/);
  assert.match(card, /const runUpdate = async[\s\S]*try \{[\s\S]*await onUpdate\([\s\S]*catch \{[\s\S]*finally \{[\s\S]*requestInFlightRef\.current = false;[\s\S]*setBusy\(false\)/);
  assert.match(card, /const runDelete = async[\s\S]*try \{[\s\S]*await onDelete\([\s\S]*catch \{[\s\S]*finally \{[\s\S]*requestInFlightRef\.current = false;[\s\S]*setBusy\(false\)/);
  assert.match(margin, /onClick=\{\(\) => onSelectAuthoredConnection\?\.\(connection, true\)\}/,
    "an authored row must hand both pointer and keyboard focus to the persistent inspector entry point before it unmounts");
  assert.match(margin, /lastConnectionInspectorFocusRequestRef[\s\S]*connectionInspectorFocusRequest[\s\S]*if \(!connectionInspectorOpen\) return;[\s\S]*frameTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
    "an explicit inspector-entry request must focus the persistent Study heading");
  const inspectorOpenEffect = margin.slice(
    margin.indexOf("const connectionInspectorWasOpenRef"),
    margin.indexOf("const lastConnectionInspectorFocusRequestRef"),
  );
  assert.doesNotMatch(inspectorOpenEffect, /frameTitleRef\.current\?\.focus/,
    "opening from the reading canvas must not steal focus without an explicit inspector-entry request");
  assert.match(margin, /aria-describedby="living-margin-mode"/);
  assert.match(margin, /id="living-margin-mode"[\s\S]*aria-live="polite"/);
  assert.match(styles, /\.connection-card \{[\s\S]*width: min\(340px, 100%\);[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
  assert.match(styles, /\.connection-card \{[\s\S]*padding: 12px 14px 10px;[\s\S]*border: 1px solid var\(--border-subtle\);[\s\S]*border-radius: var\(--radius-md\);[\s\S]*background: var\(--bg-surface\);[\s\S]*box-shadow: none;/);
  assert.match(styles, /\.theme-glass \.connection-card,[\s\S]*background: color-mix[\s\S]*backdrop-filter: none;/);
  assert.match(styles, /\.connection-card-kind-mark \{[\s\S]*width: 12px;[\s\S]*height: 2px;[\s\S]*border-radius: 999px;[\s\S]*background: var\(--connection-ink\);[\s\S]*box-shadow: none;/,
    "the card's sole hue mark must remain a line-vocabulary tick, never a generic status dot");
  assert.match(styles, /\.connection-card-observation \{[\s\S]*border-bottom: 1px solid var\(--border-subtle\);[\s\S]*\.connection-card-observation textarea \{[\s\S]*field-sizing: content;[\s\S]*font: italic 400 0\.78rem\/1\.5 var\(--font-reading\);/,
    "the authored observation must retain the lab's quiet typeset hairline treatment");
  assert.match(styles, /\.connection-card-title \{[\s\S]*font: 500 0\.8125rem\/1\.4 var\(--font-ui\)/);
  assert.match(styles, /\.connection-card-quote \{[\s\S]*font: 400 0\.8125rem\/1\.5 var\(--font-reading\)/);
  assert.match(styles, /\.connection-card-anchor-state \{[\s\S]*font-variant-caps: all-small-caps/);
  assert.match(styles, /\.connection-card-anchors li:hover \.connection-card-remove,[\s\S]*opacity: 1/);
  assert.match(styles, /\.connection-card button \{[\s\S]*background: transparent;/);
  assert.match(styles, /\.connection-card-actions button \{[\s\S]*font: 400 0\.625rem\/1 var\(--font-ui\)/);
  assert.doesNotMatch(styles, /\.connection-card-actions \.danger|\.connection-card-remove:hover[^}]*var\(--error\)/);
  const cardRules = styles.slice(
    styles.indexOf(".connection-card {"),
    styles.indexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf(".connection-card {")),
  );
  const cardReducedMotionStart = styles.indexOf(
    "@media (prefers-reduced-motion: reduce)",
    styles.indexOf(".connection-card {"),
  );
  const cardReducedMotionEnd = styles.indexOf("@media (forced-colors: active)", cardReducedMotionStart);
  const cardReducedMotion = styles.slice(cardReducedMotionStart, cardReducedMotionEnd);
  for (const selector of [".connection-card-quote", ".connection-card-remove"]) {
    assert.ok(cardReducedMotion.includes(selector), `${selector} must stop transitioning under reduced motion`);
  }
  assert.match(cardReducedMotion, /animation: none !important; transition: none !important;/);
  assert.equal([...cardRules.matchAll(/var\(--connection-ink\)/g)].length, 1, "the kind mark is the card's only hue element");
  assert.doesNotMatch(cardRules, /border-inline-start|linear-gradient|var\(--error\)|\bdanger\b/);
  assert.doesNotMatch(styles, /scripture-reading-stage:has\(\.connection-card\)/);
  assert.doesNotMatch(
    styles,
    /has-connection-inspector[^}]*display:\s*none/,
    "the compact inspector must coexist with the real Study tree",
  );
  assert.match(
    styles,
    /\.scripture-body > \.living-margin \.margin-tabs \{[\s\S]*margin-inline: -12px;/,
    "compact Study tabs must use the actual margin padding instead of the desktop gutter",
  );
  assert.match(styles, /\.connection-card-anchors \{[\s\S]*overflow: visible;/);
  const connectionCardBlock = styles.slice(
    styles.indexOf(".connection-card {"),
    styles.indexOf(".connection-card:focus"),
  );
  const connectionTickStart = styles.indexOf(".connection-tick {");
  const connectionTickBlock = styles.slice(connectionTickStart, styles.indexOf("}", connectionTickStart));
  assert.doesNotMatch(connectionTickBlock, /--connection-ink\s*:/, "tick must retain its semantic kind variable");
  assert.doesNotMatch(connectionCardBlock, /--connection-ink\s*:/, "card must retain its semantic kind variable");
  assert.doesNotMatch(
    connectionCardBlock,
    /\banimation\s*:/,
    "a short-lived inspector must not be retained by a DocumentTimeline animation",
  );
  assert.doesNotMatch(styles, /@keyframes connection-card-in/);
});

test("connection traces measure and paint in one persistent responsive coordinate frame", () => {
  const source = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const lifecycle = read("src", "renderer", "utils", "useUnderlayMeasurementLifecycle.ts");
  const styles = read("src", "renderer", "styles.css");

  assert.match(source, /const overlayRef = useRef<SVGSVGElement \| null>\(null\)/);
  assert.match(source, /const base = overlay\.getBoundingClientRect\(\)/);
  assert.match(source, /data-connection-overlay=""/);
  assert.match(source, /data-coordinate-frame="self"/);
  assert.match(source, /useUnderlayMeasurementLifecycle\(\{/);
  assert.match(source, /observeStage: true/);
  assert.match(source, /contentRevision: unknown/);
  assert.match(source, /\[book, chapter, invalidateLayout, packageId, scheduleMeasure\]/);
  assert.match(source, /\[contentRevision, scheduleMeasure, themeToken\]/);
  assert.match(read("src", "renderer", "components", "ScripturePage.tsx"), /contentRevision=\{chapterData\}/);
  assert.match(lifecycle, /import \{ useCallback, useEffect, useRef \} from "react"/);
  assert.doesNotMatch(lifecycle, /useLayoutEffect/);
  assert.match(lifecycle, /window\.requestAnimationFrame/);
  assert.match(lifecycle, /observer\.observe\(stage\)/);
  assert.match(lifecycle, /fontSet\.ready\.then/);
  assert.match(lifecycle, /fontSet\.addEventListener\("loadingdone"/);
  assert.match(styles, /--connection-loom-gutter:/);
  assert.match(styles, /margin-inline: calc\(-1 \* var\(--connection-loom-gutter\)\)/);
  assert.match(styles, /padding-inline: var\(--connection-loom-gutter\)/);
  assert.doesNotMatch(source, /new DOMRect/);
  assert.doesNotMatch(source, /\bleftLoomX\s*:/);
  assert.doesNotMatch(source, /\brightLoomX\s*:/);
});

test("connection underline pins cancel measured font slack on one 1.5px datum", () => {
  const source = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const geometry = read("src", "renderer", "utils", "connectionGeometry.ts");
  const engine = read("src", "core", "annotations", "route-engine.ts");
  const styles = read("src", "renderer", "styles.css");

  for (const rawBottom of [21.25, 84, 139.875]) {
    for (const slack of [0, 0.625, 2.25, 4.75]) {
      const inkBottom = rawBottom - slack;
      const pin = inkBottom + connectionUnderlineDy(slack);
      assert.equal(pin, connectionUnderlineCenter(rawBottom));
    }
  }
  assert.equal(CONNECTION_UNDERLINE_CENTER_OFFSET, 0.75);
  assert.equal(CONNECTION_UNDERLINE_QUIET_STROKE, 1);
  assert.equal(CONNECTION_UNDERLINE_SELECTED_STROKE, 1.5);
  assert.equal(CONNECTION_ROUTE_QUIET_STROKE, 1.25);
  assert.equal(CONNECTION_ROUTE_SELECTED_STROKE, 1.5);
  assert.match(engine, /const UNDERLINE_STRIP = 2\.25;/);
  assert.match(source, /underlineDy: connectionUnderlineDy\(inkSlack\.bottom\)/);
  assert.match(source, /connectionUnderlineCenter\(rawRect\.bottom\)/);
  assert.match(source, /onFontsSettled: handleFontsSettled/);
  assert.match(source, /clearConnectionFontMetricCache\(\);[\s\S]*fontRevisionRef\.current \+= 1;[\s\S]*invalidateLayout\(\)/);
  assert.match(geometry, /inkSlackCache\.clear\(\)/);
  assert.doesNotMatch(source, /underlineDy:\s*0/);
  assert.doesNotMatch(source, /bottom:\s*rect\.bottom - base\.top - 2\.25/);
  assert.match(styles, /--connection-underline-selected-width, 1\.5px/);
  assert.match(styles, /--connection-route-quiet-width, 1\.25px/);
  assert.doesNotMatch(styles, /\.connection-mark\.held \.connection-underline \{[^}]*stroke-dasharray/);
});

test("congested connection traces prioritize selected and ordered held routes without destabilizing tick order", () => {
  const source = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const activeGate = source.indexOf("const active = orderActiveConnections");
  const wordMeasurement = source.indexOf("const wordRuns:");

  assert.ok(activeGate >= 0, "missing active-connection gate");
  assert.ok(wordMeasurement > activeGate, "active connections must be filtered before word Range measurement");
  assert.match(
    source.slice(activeGate, wordMeasurement),
    /if \(active\.length === 0\)[\s\S]*return;/,
    "a dormant underlay must clear and return before reading layout",
  );

  const connection = (id: string, book: "ACT" | "ROM", chapter: number): ConnectionRecord => ({
    id,
    format_version: 1,
    kind: "link:parallel",
    label: id,
    activeEventId: `event-${id}`,
    anchors: [
      { book, chapter, verse_start: 1, verse_end: 1 },
      { book, chapter, verse_start: 2, verse_end: 2 },
    ],
  });
  const input = [
    connection("z-held", "ACT", 19),
    connection("outside", "ROM", 8),
    connection("a-held", "ACT", 19),
    connection("m-selected", "ACT", 19),
    connection("b-quiet", "ACT", 19),
    connection("y-quiet", "ACT", 19),
  ];

  assert.deepEqual(
    orderActiveConnections(
      input,
      "ACT",
      19,
      "m-selected",
      ["z-held", "m-selected", "missing", "a-held", "z-held"],
    ).map(({ id }) => id),
    ["m-selected", "z-held", "a-held", "b-quiet", "y-quiet"],
    "claim order must be selected, held companions in hold order, then quiet ids",
  );
  assert.deepEqual(
    orderActiveConnections(input, "ACT", 19, null).map(({ id }) => id),
    ["a-held", "b-quiet", "m-selected", "y-quiet", "z-held"],
    "unfocused claim order must remain stable by durable id",
  );
  assert.deepEqual(
    input.map(({ id }) => id),
    ["z-held", "outside", "a-held", "m-selected", "b-quiet", "y-quiet"],
    "ranking must not mutate caller data",
  );

  const spatial = [
    { connection: { id: "lower" }, focusY: 410 },
    { connection: { id: "same-z" }, focusY: 180 },
    { connection: { id: "upper" }, focusY: 40 },
    { connection: { id: "same-a" }, focusY: 180 },
  ];
  assert.deepEqual(
    orderConnectionTicks(spatial).map(({ connection: { id } }) => id),
    ["upper", "same-a", "same-z", "lower"],
    "tick tab order must remain spatial even when route paint priority changes",
  );
  assert.deepEqual(
    spatial.map(({ connection: { id } }) => id),
    ["lower", "same-z", "upper", "same-a"],
    "spatial tick ordering must not mutate the painted input",
  );

  assert.match(source, /const visualFocusId = selectedConnectionId \?\? \(focusMode \? null : previewConnectionId\)/,
    "normal reading may preview a Shape, but hidden Focus-mode previews cannot own interaction");
  assert.match(source, /const active = orderActiveConnections\(paintRecords, book, chapter, visualFocusId, heldConnectionIds\)/);
  assert.match(source, /const focused = selectedConnectionId === connection\.id/);
  assert.match(source, /if \(!focused\) \{[\s\S]*routePath: ""[\s\S]*continue;/);
  assert.match(source, /selectedConnectionId && focusHasExactPaint && <rect/);
  assert.match(source, /item\.connection\.id === selectedConnectionId \|\| heldConnectionIds\.includes/);
  assert.doesNotMatch(source, /item\.connection\.id === visualFocusId \|\| heldConnectionIds\.includes/);
  assert.match(source, /focused && item\.valid && item\.routePath && <path[\s\S]*className="connection-route-hit"/);
  assert.match(source, /data-paint-state=\{paintState\}/);
  assert.match(source, /className="connection-emphasis-wash"/);
  assert.match(source, /data-line-count=\{emphasis\.bands\.length\}/);
  assert.match(source, /className="connection-emphasis-shared"/);
  assert.match(source, /const renderedFragments = mergeRenderedLines\(fragments\.map[\s\S]*fragments: renderedFragments/);
  assert.match(source, /const sides: RouteSide\[\] = block\.preferredMargin === "right"[\s\S]*\["right", "left"\][\s\S]*\["left", "right"\]/);
  assert.match(source, /data-line-index=\{underline\.lineIndex\}/);
  assert.match(source, /data-underline-level=\{overlapsFocus \? companionLevel : 0\}/);
  assert.match(source, /const tickPainted = orderConnectionTicks\([\s\S]*isDurablePaintRecord\(item\.connection\)/);
  assert.match(source, /const claimPriority = new Map\(active\.map/);
});

test("selection and row-local reflow reuse measured layout while planner faults remain held", () => {
  const source = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const cacheGate = source.indexOf("if (!cachedLayout");
  const wordMeasurement = source.indexOf("const wordRuns:");

  assert.ok(cacheGate >= 0 && wordMeasurement > cacheGate, "word Range scans must live behind the layout-cache miss gate");
  assert.match(source, /const layoutCacheRef = useRef<LayoutCache \| null>\(null\)/);
  assert.match(source, /anchorFragments: Map<string, MeasuredAnchorFragment\[\]>/);
  assert.match(source, /rows: Map<number, ConnectionRowLayoutMeasurement<HTMLDivElement, VerseRowGeometry>>/);
  assert.match(source, /let fragments = cachedLayout\.anchorFragments\.get\(measurementKey\)/);
  assert.match(source, /cachedLayout\.anchorFragments\.set\(measurementKey, fragments\)/);
  assert.match(source, /const reconciledRows = reconcileConnectionRows\(/);
  assert.match(source, /anchorVerses\.some\(\(verse\) => reconciledRows\.remeasuredVerses\.has\(verse\)\)/);
  assert.match(source, /fragments = reprojectAnchorFragments\(/);
  assert.match(source, /const computedStyle = getComputedStyle\(container\)[\s\S]*connectionLayoutSignature/);
  assert.doesNotMatch(source, /invalidateMeasurement: invalidateLayout/);
  assert.match(source, /onFontsSettled: handleFontsSettled/);
  assert.match(source, /try \{[\s\S]*plan = planRoute[\s\S]*\} catch \{[\s\S]*reason: "engine-error"/);

  const signatureParts = {
    contextKey: "ACT:19:bsb",
    containerWidth: 680,
    containerHeight: 1240,
    stageWidth: 920,
    stageHeight: 760,
    leftInset: 48,
    rightInset: 48,
    verseRowCount: 41,
    rowGeometry: "0,680,0,28:0,680,1212,1240",
    fontSize: "17px",
    lineHeight: "28px",
    fontFamily: "Literata",
    fontWeight: "400",
    fontStyle: "normal",
    letterSpacing: "normal",
    wordSpacing: "0px",
    textIndent: "0px",
    direction: "ltr",
  };
  const baseline = connectionLayoutSignature(signatureParts);
  assert.equal(connectionLayoutSignature({ ...signatureParts }), baseline);
  assert.notEqual(connectionLayoutSignature({ ...signatureParts, containerWidth: 679 }), baseline);
  assert.notEqual(connectionLayoutSignature({ ...signatureParts, fontFamily: "Georgia" }), baseline);
  assert.notEqual(connectionLayoutSignature({ ...signatureParts, rowGeometry: "changed" }), baseline);
  assert.notEqual(connectionLayoutSignature({ ...signatureParts, contextKey: "ACT:20:bsb" }), baseline);
});

test("connection authoring holds exact phrases without creating a route or durable shadow record", () => {
  const marking = read("src", "renderer", "components", "MarkingSurface.tsx");
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const underlay = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const styles = read("src", "renderer", "styles.css");
  const draftType = marking.slice(
    marking.indexOf("export interface ConnectionDraftModel"),
    marking.indexOf("interface Props"),
  );

  assert.match(draftType, /kind: ConnectionKind;[\s\S]*anchors: readonly ConnectionPaintAnchor\[\];[\s\S]*label: string;/);
  assert.doesNotMatch(draftType, /\bid\b|format_version/);
  assert.match(marking, /const connectionDraft = useMemo<ConnectionDraftModel \| null>[\s\S]*const anchors = session\.paintAnchors/);
  assert.match(marking, /paintAnchors: \[\.\.\.base\.paintAnchors, \.\.\.current\.paintAnchors\]/);
  assert.match(marking, /onConnectionDraftChange\(connectionDraft\)/);
  assert.match(page, /const \[connectionDraft, setConnectionDraft\] = useState<ConnectionDraftModel \| null>\(null\)/);
  assert.match(page, /draftConnection=\{connectionDraft\?\.contextKey === `\$\{book\}:\$\{chapter\}:\$\{packageId\}` \? connectionDraft : null\}/);
  assert.match(page, /onConnectionDraftChange=\{setConnectionDraft\}/);
  const selectionPaintMemo = page.slice(
    page.indexOf("const markingSelectionPaintAnchors"),
    page.indexOf("const markingSelection ="),
  );
  assert.match(selectionPaintMemo, /useMemo<readonly ConnectionPaintAnchor\[\]>[\s\S]*const paintAnchors: ConnectionPaintAnchor\[\] = \[\];[\s\S]*for \(let verse = verseStart; verse <= verseEnd; verse \+= 1\)[\s\S]*fragments: \[\{[\s\S]*quote: text\.slice\(fragmentStart, fragmentEnd\)/);
  assert.doesNotMatch(selectionPaintMemo, /palettePos/);
  assert.match(page, /capture,[\s\S]*paintAnchors: markingSelectionPaintAnchors,/);
  assert.match(page, /captureConnectionSelection\([\s\S]*selectionGenerationRef\.current !== nonce[\s\S]*currentMarkingContextKeyRef\.current !== contextKey/);
  assert.doesNotMatch(page, /__connection-authoring-draft__/);

  const paintRecordType = underlay.slice(
    underlay.indexOf("type ConnectionPaintRecord ="),
    underlay.indexOf("function isDurablePaintRecord"),
  );
  assert.match(underlay, /const CONNECTION_AUTHORING_DRAFT_ID = "__connection-authoring-draft__"/);
  assert.match(paintRecordType, /source: "durable";[\s\S]*durableRecord: ConnectionRecord;/);
  assert.match(paintRecordType, /source: "authoring" \| "selection";[\s\S]*anchors: readonly ConnectionPaintAnchor\[\];/);
  assert.doesNotMatch(paintRecordType, /format_version|activeEventId/);
  assert.match(underlay, /const durablePaintRecords = useMemo<ConnectionPaintRecord\[]>\([\s\S]*paintProjections\.get\(connection\.id\)[\s\S]*source: "durable" as const,[\s\S]*durableRecord: connection,/);
  assert.match(underlay, /const draftPaintRecord = useMemo<ConnectionPaintRecord \| null>[\s\S]*source: "authoring",[\s\S]*id: CONNECTION_AUTHORING_DRAFT_ID/);
  assert.match(underlay, /const paintRecords = useMemo<ConnectionPaintRecord\[]>[\s\S]*\.\.\.durablePaintRecords,[\s\S]*draftPaintRecord[\s\S]*selectionEmphasisPaintRecord/);
  assert.match(underlay, /orderActiveConnections\(paintRecords, book, chapter, visualFocusId, heldConnectionIds\)/);
  assert.doesNotMatch(underlay, /format_version: CONNECTION_FORMAT_VERSION|renderer-authoring-draft/);
  assert.match(underlay, /const visiblePainted = painted\.filter\(\(item\) => \{/);
  assert.match(underlay, /const tickPainted = orderConnectionTicks\([\s\S]*isDurablePaintRecord\(item\.connection\)/);
  assert.match(underlay, /const sharedPaint = sharedEmphasisPaint\([\s\S]*isDurablePaintRecord\(item\.connection\)/);
  assert.match(underlay, /isDurablePaintRecord\(item\.connection\)[\s\S]*item\.connection\.id === selectedConnectionId \|\| heldConnectionIds\.includes/);
  assert.match(underlay, /onSelectConnection\(item\.connection\.durableRecord, event\.detail === 0\)/);
  assert.doesNotMatch(underlay, /onSelectConnection\(selected \? null/,
    "tick activation reaffirms focus; only the labelled card action releases a hold");
  assert.match(underlay, /authoring \? "authoring"/);
  assert.match(underlay, /data-authoring-draft=\{authoring \? "" : undefined\}/);
  assert.match(styles, /\[data-paint-state="authoring"\] \.connection-emphasis-wash \{[\s\S]*fill-opacity: \.16;[\s\S]*connection-authoring-emphasis-in/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.connection-emphasis-wash,[\s\S]*animation: none !important;/);
});

test("a live marking selection keeps exact words in focus without creating connection ink", () => {
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const underlay = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const styles = read("src", "renderer", "styles.css");

  assert.match(page, /const markingSelectionEmphasis = useMemo\([\s\S]*nonce: selectionNonce,[\s\S]*anchors: markingSelectionPaintAnchors,[\s\S]*\[hasMarkingSelection, markingSelectionPaintAnchors, selectionNonce, showHighlightPalette\]/);
  assert.match(page, /selectionEmphasis=\{markingSelectionEmphasis\}/);
  assert.match(underlay, /MARKING_SELECTION_EMPHASIS_PREFIX = "__marking-selection-emphasis__:"/);
  assert.match(underlay, /selectionEmphasisPaintRecord = useMemo<ConnectionPaintRecord \| null>[\s\S]*source: "selection",/);
  assert.match(underlay, /data-marking-selection-emphasis=\{markingSelection \? "" : undefined\}/);
  assert.match(underlay, /markingSelection \? "selection"/);
  assert.match(underlay, /const tickPainted = orderConnectionTicks\([\s\S]*isDurablePaintRecord\(item\.connection\)/);
  assert.match(underlay, /isDurablePaintRecord\(item\.connection\)[\s\S]*selectedConnectionId/);
  assert.match(styles, /\[data-paint-state="selection"\] \{[\s\S]*--connection-ink: var\(--study-gold\)/);
  assert.match(styles, /\[data-paint-state="selection"\] \.connection-emphasis-wash \{[\s\S]*fill-opacity: \.15;[\s\S]*connection-selection-emphasis-in/);
});

test("Electron rejects unknown marking-surface values at the settings boundary", () => {
  const source = read("src", "electron", "main.ts");
  assert.match(source, /function normalizeMarkingSurface\(value: unknown\)/);
  assert.match(source, /markingSurface: normalizeMarkingSurface\(store\.store\.markingSurface\)/);
  assert.match(source, /markingSurface: normalizeMarkingSurface\(partial\.markingSurface \?\? store\.store\.markingSurface\)/);
});

test("production marking surfaces retain distinct grammar at the supported desktop width", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const styles = read("src", "renderer", "styles.css");
  const railStart = source.indexOf('if (surface === "rail")');
  const dockStart = source.indexOf("const chooseMode = (", railStart);
  const rail = source.slice(railStart, dockStart);

  assert.match(source, /function PaletteVocabulary[\s\S]*RELATIONSHIPS\.map[\s\S]*PIGMENTS\.map/);
  assert.match(source, /<PaletteVocabulary[\s\S]*selectedKind=\{currentKind\}[\s\S]*selectedWash=\{currentWash \?\? selectedWash\}/);
  assert.match(source, /data-relationship-kind=\{option\.id\}/);
  assert.match(source, /data-pigment=\{option\.id\}/);
  assert.doesNotMatch(source, /progressivePalette/);

  assert.match(source, /const radialLayoutHint = effectiveStageBounds\.width <= 640 \|\| effectiveStageBounds\.height <= 420 \? "sheet" : "wheel"/);
  assert.match(source, /data-radial-layout=\{radialLayout\}/);
  assert.match(source, /data-marking-surface="radial"/);
  assert.equal([...source.matchAll(/data-focus-ring=\{focusRingMode\}/g)].length, 4);
  assert.match(source, /window\.addEventListener\("pointerdown", markPointer, true\)[\s\S]*window\.addEventListener\("keydown", markKeyboard, true\)/);
  assert.match(styles, /\[data-marking-surface\]\[data-focus-ring="keyboard"\] :is\([\s\S]*?\):focus-visible \{\s*outline: 2px solid var\(--study-gold-focus\)/);
  assert.match(styles, /\[data-marking-surface\]\[data-focus-ring="pointer"\][\s\S]*:focus-visible \{[\s\S]*outline: none;/);
  assert.match(styles, /\[data-marking-surface="palette"\]\[data-focus-ring="keyboard"\] \.marking-palette \.marking-relationship:focus-visible/);
  assert.match(styles, /\[data-marking-surface="radial"\]\[data-focus-ring="keyboard"\] \.marking-radial-petal:focus-visible/);
  assert.match(styles, /\[data-marking-surface="rail"\]\[data-focus-ring="keyboard"\] \.marking-rail-intents \.marking-intent:focus-visible/);
  assert.match(styles, /\[data-marking-surface="dock"\]\[data-focus-ring="keyboard"\] \.marking-dock-context \.marking-relationship:focus-visible/);
  assert.doesNotMatch(styles, /\.marking-(?:palette|rail-tray|dock-context)[^\n]*:is\(:hover, :focus-visible, \.active\)/);
  assert.match(source, /captureFeedback \?\? \(paletteHelp \? paletteHelp\.description/);
  assert.doesNotMatch(source, /paletteHelp \? `\$\{paletteHelp\.label\} · \$\{paletteHelp\.description\}`/);
  assert.match(source, /data-tool-armed=\{radialArmedKey \?\? "false"\}/);
  assert.match(source, /const radialPetalRadius = 124/);
  assert.match(source, /const radialRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const radialHelpCardRef = useRef<HTMLElement>\(null\)/);
  assert.match(source, /observer\.observe\(wheel\);[\s\S]*observer\.observe\(helpCard\)/);
  // The radial is a non-modal surface: its scrim covers only the stage and
  // the rest of the desk stays interactive, so it must not claim modality.
  const radialStart = source.indexOf('if (surface === "radial") {\n    if (!selection');
  const radialSource = source.slice(radialStart, source.indexOf('if (surface === "rail")', radialStart));
  assert.doesNotMatch(radialSource, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"[\s\S]*onDismissSelection\(\)/);
  assert.match(source, /event\.key !== "Tab"[\s\S]*querySelectorAll<HTMLButtonElement>\("button:not\(\[disabled\]\)"\)/);
  assert.match(source, /className=\{`marking-radial-keep[\s\S]*onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /session\.anchors\.length >= 2 && \(!binary \|\| Boolean\(session\.feedback\)\)[\s\S]*\{session\.feedback \|\| binary \? "Retry" : "Save connection"\}/);
  assert.match(source, /const captureConnection[\s\S]*if \(busy \|\| session\?\.recoveryState\) return false;/,
    "an unconfirmed command must block new phrase capture until exact Retry");
  assert.doesNotMatch(source, /Use Retry or Cancel/,
    "recovery cannot offer cancellation after the commit boundary is ambiguous");
  assert.match(source, /className="marking-armed-status"[\s\S]*>Put down<\/button>/);
  assert.match(source, /id="marking-radial-help" className=\{`marking-radial-help/);
  assert.doesNotMatch(source, /className="marking-radial-help" aria-live=/);
  assert.match(source, /onMouseEnter=\{\(\) => setRadialHelp\(option\)\}/);
  assert.match(source, /const radialRoving = useRovingFocus<HTMLButtonElement>\(RELATIONSHIPS\.length \+ PIGMENTS\.length\)/);
  assert.match(source, /onKeyDown=\{\(event\) => \{ radialRoving\.onKeyDown\(event, radialIndex\); \}\}/);
  assert.match(
    source,
    /if \(activeSelectionNonce == null \|\| persistentSurface \|\| tool\) return;[\s\S]*?firstChoiceRef\.current\?\.focus\(\{ preventScroll: true \}\);[\s\S]*?\}, \[activeSelectionNonce, palettePlacement\?\.nonce, persistentSurface, surface, tool\]\);/,
    "Radial autofocus must be keyed by selection nonce so exact-capture updates cannot steal moved focus",
  );
  assert.match(styles, /\.marking-radial \{[\s\S]*?width:\s*320px;[\s\S]*?height:\s*320px;[\s\S]*?border-radius:\s*50%;/);
  assert.match(styles, /\.marking-radial-disc \{[\s\S]*?inset:\s*2px;/);
  assert.match(styles, /\.marking-radial-petal \{[\s\S]*?color:\s*var\(--text-tertiary\)/);
  assert.match(styles, /\.marking-radial-connections \{ grid-template-columns: repeat\(6, 46px\)/);
  assert.match(styles, /\[data-radial-layout="sheet"\] \.marking-radial \{/);
  assert.doesNotMatch(styles, /\[data-stage-size="compact"\] \.marking-radial/);
  assert.match(styles, /@media \(forced-colors: active\) \{[\s\S]*\.marking-radial-keep,[\s\S]*\.marking-radial-card-actions button \{ border: 1px solid ButtonText !important; \}/);

  assert.match(source, /const railLayout = effectiveStageBounds\.width < 600 \|\| effectiveStageBounds\.height < 520 \? "bottom" : "side"/);
  assert.match(source, /const railIntentFocusReady = railTrayPlacement != null/);
  assert.match(
    source,
    /surface !== "rail" \|\| activeSelectionNonce == null \|\| tool \|\| tray != null \|\| !railIntentFocusReady[\s\S]*firstChoiceRef\.current\?\.focus[\s\S]*\[activeSelectionNonce, railIntentFocusReady, surface, tool, tray\]/,
    "side-Rail intent focus must wait for its measured tray commit",
  );
  assert.match(source, /const railTrayShouldRender = surface === "rail" && \([\s\S]*Boolean\(selection && !tool\)/);
  assert.match(source, /const panel = railTrayRef\.current;[\s\S]*panel\.getBoundingClientRect\(\);[\s\S]*railNode\.getBoundingClientRect\(\)/);
  assert.match(source, /selection\?\.position\.anchorBox \?\? openerRect \?\? railRect/);
  assert.match(source, /nativeSelection\?\.rangeCount[\s\S]*getRangeAt\(0\)\.getBoundingClientRect\(\)[\s\S]*hasLiveRange \? nativeRangeRect!/);
  assert.match(source, /anchorBox\.bottom[\s\S]*anchorBox\.left[\s\S]*anchorBox\.right[\s\S]*anchorBox\.top/);
  assert.match(source, /!intersects\(box, avoidBox\) && !intersects\(box, railBox\)/);
  assert.match(source, /data-rail-tray-placement=\{railTrayPlacement\?\.placement\}/);
  assert.match(rail, /const railTrayOpen = railTrayShouldRender/);
  assert.match(rail, /const railStatusVisible = !railTrayOpen && Boolean\(tool\) && !session/);
  assert.match(rail, /\{sessionNode\}[\s\S]*\{exitGuardNode\}/);
  assert.match(rail, /data-rail-layout=\{railLayout\}/);
  assert.equal([...rail.matchAll(/data-rail-tool=/g)].length, 4);
  assert.doesNotMatch(rail, /ToolGlyph tool="read"/);
  assert.match(rail, /aria-controls="marking-rail-tray"/);
  assert.match(rail, /id="marking-rail-tray"[\s\S]*ref=\{railTrayRef\}[\s\S]*<q title=\{selection\.quote\}>/);
  assert.match(rail, /marking-rail-intents[\s\S]*<strong>Wash<\/strong>[\s\S]*<strong>Connect<\/strong>/);
  assert.match(rail, /id="marking-rail-help"[\s\S]*railHelp\?\.description \?\?/);
  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*setRailHelp\(null\);\s*setRailTrayPlacement\(null\);\s*railRoving\.setActiveIndex\(0\);[\s\S]*\}, \[selection\?\.nonce, surface\]\);/,
    "a fresh selection must restore Highlight as the Rail's single roving toolbar stop",
  );
  assert.match(rail, /\{railTrayOpen && \([\s\S]*marking-rail-tray[\s\S]*\{railStatusVisible && \([\s\S]*marking-rail-status/);
  assert.match(rail, />Put down<\/button>/);
  assert.match(styles, /\.scripture-reading-stage:has\(\.marking-rail-host\[data-rail-layout="side"\]\) \.scripture-content \{[\s\S]*padding-left:/);
  assert.match(styles, /\.marking-rail-host\[data-rail-layout="bottom"\] \.marking-rail \{[\s\S]*bottom:\s*10px;/);
  assert.match(styles, /\.marking-rail-tray \{[\s\S]*animation:\s*marking-rail-in var\(--mark-dur-enter\)/);
  assert.match(
    styles,
    /\.marking-rail button\[data-tooltip\]::after \{[\s\S]*left: 50%;[\s\S]*width: max-content;[\s\S]*max-width: 100%;[\s\S]*overflow: hidden;/,
    "a dormant side-Rail tooltip must not enlarge the instrument's scroll geometry",
  );
  assert.match(
    styles,
    /\.marking-rail button\[data-tooltip\]:hover::after,\s*\[data-marking-surface="rail"\]\[data-focus-ring="keyboard"\] \.marking-rail button\[data-tooltip\]:focus-visible::after \{[\s\S]*left: calc\(100% \+ 9px\);[\s\S]*max-width: 190px;/,
    "the Rail tooltip may leave the shell only while visibly requested",
  );
  const bottomTrayStart = styles.indexOf('.marking-rail-host[data-rail-layout="bottom"] .marking-rail-tray {');
  const bottomTrayEnd = styles.indexOf("}", bottomTrayStart);
  assert.doesNotMatch(styles.slice(bottomTrayStart, bottomTrayEnd), /animation(?:-name)?:/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.marking-rail-tray,[\s\S]*animation:\s*none !important;/);
  assert.match(styles, /\[data-marking-surface="rail"\]\[data-focus-ring="keyboard"\] \.marking-rail button\.active:focus-visible \{ outline: 3px double Highlight; outline-offset: 2px; \}/);

  assert.match(source, /const dockMode: DockModeId = session[\s\S]*\? tray[\s\S]*: tool\?\.type \?\? "read"/);
  assert.match(source, /const dockModeIndex = Math\.max\(0, DOCK_MODES\.findIndex/);
  assert.match(source, /const dockLayout = effectiveStageBounds\.width <= 759 \? "stacked" : "shelf"/);
  assert.match(source, /group\.getBoundingClientRect\(\)[\s\S]*active\.getBoundingClientRect\(\)[\s\S]*"--mark-dock-x"[\s\S]*"--mark-dock-width"/);
  assert.match(source, /className="marking-dock-thumb" aria-hidden="true"/);
  assert.match(source, /className=\{`marking-dock\$\{dockEntranceComplete \? " is-entered" : ""\}`\}[\s\S]*event\.animationName === "marking-dock-in"[\s\S]*setDockEntranceComplete\(true\)/);
  assert.match(source, /const subtypeClass = item\.id === "connect" && currentKind[\s\S]*item\.id === "wash" && currentWash/);
  assert.match(source, /role="radiogroup" aria-label="Marking mode"/);
  assert.match(source, /role="radio"[\s\S]*data-dock-tool=\{item\.id\}[\s\S]*aria-checked=\{active\}/);
  assert.match(source, /data-dock-state=\{dockState\}[\s\S]*data-tool-armed=\{dockArmedKey\}/);
  assert.match(source, /className="marking-dock-selection"[\s\S]*Mark selection[\s\S]*data-dock-intent="wash"[\s\S]*data-dock-intent="connect"[\s\S]*selection\.quote/);
  assert.match(source, /const dockIntentRoving = useRovingFocus<HTMLButtonElement>\(2\)/);
  assert.match(source, /data-dock-intent="wash"[\s\S]*tabIndex=\{dockIntentRoving\.activeIndex === 0 \? 0 : -1\}[\s\S]*dockIntentRoving\.onKeyDown\(event, 0\)/);
  assert.match(source, /data-dock-intent="connect"[\s\S]*tabIndex=\{dockIntentRoving\.activeIndex === 1 \? 0 : -1\}[\s\S]*dockIntentRoving\.onKeyDown\(event, 1\)/);
  assert.match(source, /data-dock-action="note"[\s\S]*applyDockSelectionAction\("note"\)[\s\S]*data-dock-action="erase"[\s\S]*applyDockSelectionAction\("erase"\)/);
  assert.match(source, /selectionFailure\?\.nonce === selection\.nonce[\s\S]*data-dock-action="retry"[\s\S]*onClick=\{retryDockFailure\}/);
  assert.match(source, /opener\?\.matches\("\[data-dock-intent\]"\)[\s\S]*data-dock-intent="\$\{openerMode\}"[\s\S]*aria-checked="true"/);
  assert.match(source, /if \(id === "read"\) \{ putDownTool\(applyCurrentSelection\); return; \}/);
  assert.match(source, /if \(!applyCurrentSelection\) \{[\s\S]*if \(selection\) processedSelection\.current = selection\.nonce;[\s\S]*setTool\(id === "note" \? \{ type: "note" \} : \{ type: "erase" \}\);[\s\S]*return;/);
  assert.match(source, /setSession\(next\);\s*setTray\(null\);\s*setTool\(\{ type: "connect", kind \}\)/);
  assert.match(styles, /\.marking-dock \{[\s\S]*?width:\s*min\(1120px, 100%\);[\s\S]*?grid-template-columns:\s*208px/);
  assert.match(styles, /\.marking-dock-modes \{[\s\S]*?position:\s*relative;[\s\S]*?grid-template-columns:\s*repeat\(5, 38px\)/);
  assert.match(styles, /\.marking-dock-thumb \{[\s\S]*?width:\s*var\(--mark-dock-width, 38px\);[\s\S]*?transform:\s*translateX\(var\(--mark-dock-x, 0px\)\)/);
  assert.match(styles, /\.marking-dock:not\(\.is-entered\) \{ animation: marking-dock-in 200ms both var\(--mark-spring-soft\); \}/);
  assert.match(styles, /\.marking-dock-context \.marking-choice-glyph \{[^}]*color:\s*var\(--text-tertiary\)/);
  assert.match(styles, /\.marking-dock-actions:empty \{ display: none; \}/);
  assert.match(styles, /\.marking-dock-mode\.active\.marking-kind-parallel > svg \{ color: var\(--mark-parallel\); \}/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock \{[\s\S]*?grid-template-areas:\s*"context actions" "modes modes"/);
  assert.match(styles, /\.scripture-reading-stage:has\(\.marking-dock-host\[data-dock-layout="stacked"\]\) \{\s*--marking-bottom-inset:\s*120px;/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock:has\(> \.marking-dock-actions:empty\) \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-areas:\s*"context" "modes";[\s\S]*?column-gap:\s*0;/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock-context \.marking-session \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto/);
  assert.match(styles, /@container reading-stage \(max-width: 430px\) \{[\s\S]*?\.marking-dock-hit \{ display: none; \}[\s\S]*?\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock \{ column-gap: 8px; \}[\s\S]*?width:\s*220px;/);
  assert.match(styles, /@media \(any-pointer: coarse\) \{[\s\S]*?\.marking-dock-modes \{ width: 238px; grid-template-columns: repeat\(5, 44px\); \}[\s\S]*?data-dock-layout="stacked"\] \.marking-dock-modes \{ width: 228px; gap: 2px; \}/);
  assert.match(styles, /\.app-shell:has\(\.marking-dock-host\[data-dock-layout="shelf"\]\) \+ \.toast-container \{[\s\S]*?bottom:\s*calc\(104px/);
  assert.match(styles, /\.app-shell:has\(\.marking-dock-host\[data-dock-layout="stacked"\]\) \+ \.toast-container \{[\s\S]*?bottom:\s*calc\(144px/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.scripture-body \{[\s\S]*?flex-direction:\s*column;[\s\S]*?\.scripture-body > \.scripture-reading-stage \{[\s\S]*?min-height:\s*0;[\s\S]*?\.scripture-body > \.living-margin \{[\s\S]*?position:\s*static;[\s\S]*?width:\s*100%;[\s\S]*?max-height:\s*clamp\(144px, 34vh, 320px\)/);
  assert.doesNotMatch(styles, /\.scripture-body > \.living-margin \{[^}]*position:\s*absolute/);
});

test("temporary marking preferences reset at surface and reading boundaries", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?setSession\(\(current\) => current\?\.recoveryState \? current : null\);[\s\S]*?setKeepActive\(false\);[\s\S]*?\}, \[contextKey\]\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*setKeepActive\(false\);\s*\}, \[surface\]\)/);
  assert.match(source, /const putDownTool = \(requestReadingFocus = true\): void => \{[\s\S]*?setKeepActive\(false\);[\s\S]*?if \(requestReadingFocus\) onRequestReadingFocus/);
});

test("Dock note capture preserves exact multi-verse words and rejects duplicate saves", () => {
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const note = read("src", "renderer", "components", "NoteCapture.tsx");
  const noteStart = page.indexOf("const handleNoteFromSelection");
  const noteEnd = page.indexOf("const handleNoteCaptureSaved", noteStart);
  const capture = page.slice(noteStart, noteEnd);

  assert.match(capture, /verse === verseStart && phraseSelection\.charStart[\s\S]*fragment\.slice\(phraseSelection\.charStart\)/);
  assert.match(capture, /verse === verseEnd && phraseSelection\.charEnd[\s\S]*phraseSelection\.charEnd - phraseSelection\.charStart/);
  assert.match(note, /const savingRef = useRef\(false\)/);
  assert.match(note, /if \(savingRef\.current\) return;[\s\S]*const t = title\.trim\(\)/);
  assert.doesNotMatch(note, /title\.trim\(\) \|\| draft\.passageRef/);
});

test("marking keyboard movement separates vocabulary focus from committed choices", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const rovingStart = source.indexOf("function useRovingFocus");
  const relationshipStart = source.indexOf("function RelationshipChoices", rovingStart);
  const pigmentStart = source.indexOf("function PigmentChoices", relationshipStart);
  const dockStart = source.indexOf("const chooseMode = (", pigmentStart);
  const roving = source.slice(rovingStart, relationshipStart);
  const relationships = source.slice(relationshipStart, pigmentStart);
  const pigments = source.slice(pigmentStart, source.indexOf("function SessionStatus", pigmentStart));
  const dock = source.slice(dockStart);

  assert.doesNotMatch(roving, /onMove|onChoose/);
  assert.match(roving, /setActiveIndex\(normalized\);[\s\S]*refs\.current\[normalized\]\?\.focus\(\);[\s\S]*return normalized;/);
  assert.match(relationships, /useRovingFocus<HTMLButtonElement>\(RELATIONSHIPS\.length,/);
  assert.match(pigments, /useRovingFocus<HTMLButtonElement>\(PIGMENTS\.length,/);
  assert.equal([...`${relationships}\n${pigments}`.matchAll(/index === Math\.max\(0, selectedIndex\) && initialFocusRef/g)].length, 2);
  assert.match(relationships, /role=\{activateOnMove \? "radiogroup" : "group"\} aria-label="Connection type"/);
  assert.match(pigments, /role=\{activateOnMove \? "radiogroup" : "group"\} aria-label="Highlight color"/);
  assert.match(relationships, /role=\{activateOnMove \? "radio" : undefined\}[\s\S]*aria-checked=\{activateOnMove \? selected === option\.id : undefined\}/);
  assert.match(pigments, /role=\{activateOnMove \? "radio" : undefined\}[\s\S]*aria-checked=\{activateOnMove \? selected === option\.id : undefined\}/);
  assert.match(relationships, /if \(activateOnMove && next != null\) \(onMoveChoose \?\? onChoose\)\(RELATIONSHIPS\[next\]!\.id\)/);
  assert.match(pigments, /if \(activateOnMove && next != null\) \(onMoveChoose \?\? onChoose\)\(PIGMENTS\[next\]!\.id\)/);
  assert.equal([...`${relationships}\n${pigments}`.matchAll(/if \(!activateOnMove\) event\.preventDefault\(\)/g)].length, 2);
  assert.equal([...`${relationships}\n${pigments}`.matchAll(/activateOnMove \? \(onMoveChoose \?\? onChoose\) : onChoose/g)].length, 2);
  assert.equal([...source.matchAll(/activateOnMove=\{surface === "dock" && !selection\}/g)].length, 2);
  assert.match(source, /lastDockAutofocusedSelectionRef\.current === activeSelectionNonce[\s\S]*if \(tool \|\| tray != null \|\| session \|\| busy \|\| selectionFailure\?\.nonce === activeSelectionNonce\) return[\s\S]*lastDockAutofocusedSelectionRef\.current = activeSelectionNonce/);
  assert.match(source, /const timer = window\.setTimeout\(\(\) => \{[\s\S]*target\.focus\(\{ preventScroll: true \}\);[\s\S]*lastDockAutofocusedSelectionRef\.current = activeSelectionNonce;/);
  assert.match(source, /if \(surface !== "dock" \|\| busy \|\| !session\?\.feedback\) return;[\s\S]*\.marking-session-action\.primary:not\(:disabled\)[\s\S]*focus\(\{ preventScroll: true \}\)[\s\S]*\[busy, session\?\.feedback, surface\]/);
  assert.match(source, /function PaletteVocabulary[\s\S]*const count = RELATIONSHIPS\.length \+ PIGMENTS\.length/);
  assert.ok(source.includes('aria-keyshortcuts={`${index + 1}`}'));
  assert.ok(source.includes('aria-keyshortcuts={`Shift+${pigmentIndex + 1}`}'));
  assert.ok(source.includes('const match = /^Digit([1-6])$/.exec(event.code);'));
  assert.match(dock, /const nextIndex = dockModeRoving\.onKeyDown\(event, index\);[\s\S]*if \(nextMode\) \{[\s\S]*chooseMode\(nextMode\.id, dockModeRoving\.refs\.current/);
});

test("persistent trays close locally and restore their opener on Escape", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(source, /const trayPanelRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const trayOpenerRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(source, /const closeTray = useCallback\(\(restoreFocus: boolean\)[\s\S]*opener\?\.isConnected[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /const ownerContextKey = currentContextKey\.current;[\s\S]*currentContextKey\.current !== ownerContextKey/);
  assert.match(source, /const toolbar = surface === "rail" \? railRef\.current : dockModesRef\.current/);
  assert.match(source, /if \(!persistentSurface \|\| \(tray !== "connect" && tray !== "wash"\)\) return;[\s\S]*document\.addEventListener\("mousedown", onMouseDown\)/);
  const escapeHandler = source.slice(source.indexOf("const onKeyDown = (event: KeyboardEvent)"), source.indexOf("window.addEventListener", source.indexOf("const onKeyDown = (event: KeyboardEvent)")));
  assert.ok(escapeHandler.indexOf("closeTray(true)") < escapeHandler.indexOf("if (activeSelectionNonce != null)"), "Escape must close a persistent tray before dismissing the selection");
  assert.match(escapeHandler, /if \(activeSelectionNonce != null\)[\s\S]*clearPendingFocusRestore\(\)[\s\S]*onDismissSelection\(\)[\s\S]*onRequestReadingFocus\(selection \? selection\.paintAnchors : undefined\)/);
  assert.match(escapeHandler, /if \(tool\)[\s\S]*clearPendingFocusRestore\(\)[\s\S]*setTool\(null\)[\s\S]*onRequestReadingFocus\(\)/);
});

test("marking Escape owns Focus-mode ordering while yielding to higher layers", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const handlerStart = source.indexOf("const onKeyDown = (event: KeyboardEvent)");
  const listenerStart = source.indexOf('window.addEventListener("keydown", onKeyDown, true)', handlerStart);
  const escapeHandler = source.slice(handlerStart, listenerStart);

  assert.ok(handlerStart >= 0 && listenerStart > handlerStart, "the marking Escape handler must register in capture");
  assert.match(escapeHandler, /if \(!layerKind\) return/);
  assert.match(escapeHandler, /if \(!isTopLayer\(layerRef\.current\)\) return/);
  assert.ok(
    escapeHandler.indexOf("isTopLayer(layerRef.current)") < escapeHandler.indexOf("if (busy || activeOperation.current != null)"),
    "higher registry layers must retain the first Escape",
  );
  assert.match(escapeHandler, /if \(persistentSurface && \(tray === "connect" \|\| tray === "wash"\)\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)[\s\S]*closeTray\(true\)/);
  assert.match(escapeHandler, /if \(activeSelectionNonce != null\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)[\s\S]*onDismissSelection\(\)/);
  assert.match(source, /window\.addEventListener\("keydown", onKeyDown, true\)[\s\S]*window\.removeEventListener\("keydown", onKeyDown, true\)/);
});

test("Radial keeps its outside-dismiss shield through the completing click", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const scrimStart = source.indexOf('<div className="marking-radial-scrim"');
  const radialPanelStart = source.indexOf("ref={radialRef}", scrimStart);
  const scrim = source.slice(scrimStart, radialPanelStart);

  assert.ok(scrimStart >= 0 && radialPanelStart > scrimStart);
  assert.match(scrim, /onPointerDown=\{\(event\) => \{[\s\S]*event\.target !== event\.currentTarget[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
  assert.match(scrim, /onClick=\{\(event\) => \{[\s\S]*event\.target !== event\.currentTarget[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*onDismissSelection\(\)/);
  assert.doesNotMatch(scrim, /onMouseDown=/, "mousedown must not unmount the shield before the gesture completes");
  assert.ok(
    scrim.indexOf("onClick=") < scrim.indexOf("onDismissSelection()"),
    "outside dismissal must occur from the completed click, not pointerdown",
  );
});

test("floating marking surfaces resolve the live reading-stage geometry", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const page = read("src", "renderer", "components", "ScripturePage.tsx");

  assert.doesNotMatch(source, /measuredStageBounds|document\.querySelector<HTMLElement>\("\.scripture-reading-stage"\)|MutationObserver/);
  assert.match(source, /const effectiveStageBounds = stageBounds/);
  assert.match(source, /const panel = paletteRef\.current[\s\S]*panel\.getBoundingClientRect\(\)/);
  assert.match(source, /const observer = new ResizeObserver\(schedule\);[\s\S]*observer\.observe\(panel\)/);
  assert.match(source, /const anchor = selection\.position\.anchorBox/);
  assert.match(source, /\|\| \(!canOpenAbove && !canOpenBelow\)[\s\S]*\? "sheet"[\s\S]*: "floating"/);
  assert.match(page, /const observer = new ResizeObserver\(measure\);[\s\S]*observer\.observe\(stage\)/);
  assert.match(page, /stageBounds=\{stageBounds\}/);
  assert.match(source, /"--mark-stage-width": `\$\{effectiveStageBounds\.width\}px`/);
  assert.match(source, /"--mark-palette-max-height": `\$\{Math\.max\(0, effectiveStageBounds\.height - 16\)\}px`/);
});

test("marking materials stay neutral, shared, and accessibility-safe", () => {
  const styles = read("src", "renderer", "styles.css");
  const marking = styles.slice(
    styles.indexOf("/* --- Production marking surfaces"),
    styles.indexOf("/* Settings preview cards"),
  );
  const ruleBlock = (selector: string): string => {
    const ruleStart = marking.indexOf(`\n${selector} {`);
    assert.notEqual(ruleStart, -1, `missing rule for ${selector}`);
    const start = ruleStart + 1;
    const end = marking.indexOf("}", start);
    assert.notEqual(end, -1, `unterminated rule for ${selector}`);
    return marking.slice(start, end + 1);
  };

  for (const token of ["--mark-e1:", "--mark-e2:", "--mark-e3:", "--mark-rim:", "--mark-spring:"]) {
    assert.ok(marking.includes(token), `missing shared material token ${token}`);
  }
  assert.doesNotMatch(marking, /--mark-lens\s*:|background:\s*var\(--mark-lens\)/);
  for (const selector of [
    ".marking-palette",
    ".marking-radial-hub",
    ".marking-rail",
    ".marking-rail-tray",
    ".marking-rail-status",
    ".marking-dock",
  ]) {
    assert.match(ruleBlock(selector), /background:\s*var\(--bg-surface\);/, `${selector} must use a flat neutral base material`);
  }
  assert.match(ruleBlock(".marking-radial-scrim"), /radial-gradient/, "the Radial focus field must keep its focal gradient");
  assert.match(ruleBlock(".marking-radial-disc"), /radial-gradient/, "the Radial disc must keep its depth gradient");
  assert.match(
    marking,
    /data-radial-layout="sheet"\] \.marking-radial \{[^}]*background:\s*var\(--bg-surface\);/,
    "the Radial sheet must use the same flat neutral material",
  );
  for (const selector of [".theme-glass .marking-rail", ".theme-glass .marking-radial-hub", ".theme-glass .marking-dock"]) {
    assert.ok(marking.includes(selector), `${selector} must share the Glass material treatment`);
  }
  const glassPaletteStart = marking.indexOf(".theme-glass .marking-palette,");
  const glassPalette = marking.slice(glassPaletteStart, marking.indexOf("}", glassPaletteStart) + 1);
  assert.match(glassPalette, /background:\s*color-mix\(in srgb, var\(--bg-surface\) 84%, transparent\);/);
  assert.match(glassPalette, /backdrop-filter:\s*blur\(18px\) saturate\(1\.12\);/);
  assert.doesNotMatch(marking, /\.marking-icon-action\.danger:hover\s*\{[^}]*var\(--error\)/);
  const shortcutKeys = ruleBlock(".marking-palette-shortcuts kbd");
  assert.match(shortcutKeys, /border:\s*0;/);
  assert.match(shortcutKeys, /background:\s*transparent;/);
  assert.match(shortcutKeys, /box-shadow:\s*none;/);
  for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.ok(
      marking.includes(`.marking-palette .marking-pigment-${color} { background: color-mix(in srgb, var(--hl-${color}-mark) 46%, var(--bg-surface)); }`),
      `Palette ${color} pigment must reuse the calibrated flat Rail mix`,
    );
  }
  assert.match(ruleBlock(".marking-palette .marking-pigment"), /box-shadow:\s*none;/);
  assert.match(ruleBlock(".marking-dock .marking-pigment"), /box-shadow:\s*none;/);
  assert.match(
    marking,
    /\.theme-glass \.marking-palette::after,\s*\.theme-dark-glass \.marking-palette::after \{\s*background: color-mix\(in srgb, var\(--bg-surface\) 84%, transparent\);\s*\}/,
  );
  assert.match(marking, /\.marking-palette\.is-placed \{\s*--mark-palette-enter-y: 4px;\s*--mark-palette-enter-scale: \.955;\s*animation: marking-palette-in var\(--mark-dur-enter\) var\(--mark-spring\);/);
  assert.match(marking, /@keyframes marking-palette-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(var\(--mark-palette-enter-y\)\) scale\(var\(--mark-palette-enter-scale\)\);/);
  assert.match(marking, /\.marking-palette\.flipped\.is-placed \{ --mark-palette-enter-y: -4px; \}/);
  assert.match(marking, /data-palette-layout="sheet"\] \.marking-palette \{\s*--mark-palette-enter-y: 5px;\s*--mark-palette-enter-scale: \.985;/);
  assert.doesNotMatch(marking, /animation-name:\s*marking-palette|@keyframes marking-palette-(?:in-below|sheet-in)/);
  assert.equal([...marking.matchAll(/animation:\s*marking-palette-[\w-]+/g)].length, 1, "Palette variants must never introduce a second animation assignment");
  assert.equal([...marking.matchAll(/@keyframes marking-palette-in\s*\{/g)].length, 1, "Palette placement variants must share one entrance animation name");
  assert.match(marking, /@keyframes marking-radial-item-in \{ from \{ opacity: 0; scale: \.9; \} \}/);
  assert.doesNotMatch(marking, /\.marking-radial-disc::(?:before|after)/);
  assert.match(marking, /data-radial-layout="wheel"[^}]*\.marking-radial-petal \{\s*box-shadow:\s*none;/);
  assert.match(marking, /data-dock-layout="stacked"[^}]*grid-template-areas:\s*"context actions" "modes modes"/);
  assert.match(marking, /data-dock-layout="stacked"[^}]*\.marking-dock-context \{[^}]*border-bottom:\s*1px solid var\(--border-subtle\)/);
  assert.match(marking, /data-radial-layout="sheet"[^}]*\.marking-radial-hub \{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*none;/);
  assert.match(marking, /data-radial-layout="sheet"[^}]*\.marking-radial-help-card \{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border-subtle\);[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);

  const thumbStart = marking.indexOf(".marking-dock-thumb {");
  const thumbEnd = marking.indexOf("}", thumbStart);
  const thumb = marking.slice(thumbStart, thumbEnd);
  assert.match(thumb, /background:\s*color-mix\([^;]*var\(--bg-surface\)\)/);
  assert.doesNotMatch(thumb, /--mark-(?:parallel|contrast|echo|mirror|series|hinge)|--hl-/);

  const reducedStart = marking.indexOf("@media (prefers-reduced-motion: reduce)");
  const forcedStart = marking.indexOf("@media (forced-colors: active)", reducedStart);
  const reduced = marking.slice(reducedStart, forcedStart);
  for (const selector of [".marking-palette", ".marking-radial-petal", ".marking-rail-tray", ".marking-dock-thumb"]) {
    assert.ok(reduced.includes(selector), `${selector} must honor reduced motion`);
  }
  assert.match(reduced, /animation:\s*none !important/);
  assert.match(reduced, /transition:\s*none !important/);

  const forced = marking.slice(forcedStart);
  assert.match(forced, /\.marking-pigment::after[^}]*content:\s*attr\(data-forced-code\)/);
  assert.match(forced, /\.marking-dock-thumb \{[^}]*display:\s*none/);
  assert.match(forced, /\[data-marking-surface="dock"\]\[data-focus-ring="keyboard"\] \.marking-dock-mode\.active:focus-visible \{ outline: 3px double Highlight/);
});

test("marking surface guidance stays contextual and quiet", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(source, /const REST_GUIDANCE = "Select words, or choose a tool to keep in hand\.";/);
  assert.match(source, /useState\(REST_GUIDANCE\)/);
  assert.doesNotMatch(source, /Read tool active\./);
  assert.equal(
    [...source.matchAll(/>\{surface === "dock" && dockHelp \? dockHelp\.description :/g)].length,
    1,
    "the wash tray should show the contextual description once instead of repeating its label",
  );
  assert.match(source, /captureFeedback \?\? \(surface === "dock" && dockHelp \? dockHelp\.description/);
  assert.equal(source.includes("${dockHelp.label} · ${dockHelp.description}"), false);
  assert.match(
    source,
    /radialLayout === "wheel"\s*\? "Connections arc above\. Quiet pigments settle below\."\s*: "Choose a relationship or a quiet wash\."/,
  );
});

test("a connection selection is marked processed only after capture accepts it", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const captureStart = source.indexOf("const captureConnection");
  const applyStart = source.indexOf("const applyTool", captureStart);
  const applyEnd = source.indexOf("const chooseWash", applyStart);
  const capture = source.slice(captureStart, applyStart);
  const apply = source.slice(applyStart, applyEnd);

  assert.match(capture, /MarkingSelectionModel\): boolean/);
  assert.match(capture, /if \(busy \|\| session\?\.recoveryState\) return false;/);
  assert.match(apply, /Promise<boolean>/);
  assert.match(
    apply,
    /if \(nextTool\.type === "connect"\) \{[\s\S]*if \(!captureConnection\(nextTool\.kind, current\)\)[\s\S]*return false;[\s\S]*processedSelection\.current = current\.nonce;[\s\S]*return true;/,
  );
  assert.ok(
    apply.indexOf("processedSelection.current = current.nonce") > apply.indexOf("captureConnection(nextTool.kind, current)"),
    "busy or rejected connection capture must leave the selection pending",
  );
});

test("Pen Rail keeps async outcomes truthful and returns keyboard focus to Scripture", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const finishStart = source.indexOf("const finishConnection");
  const captureStart = source.indexOf("const captureConnection", finishStart);
  const finish = source.slice(finishStart, captureStart);
  const escapeStart = source.indexOf("const onKeyDown = (event: KeyboardEvent)");
  const escapeEnd = source.indexOf("window.addEventListener", escapeStart);
  const escape = source.slice(escapeStart, escapeEnd);

  assert.match(finish, /const operation = beginOperation\(\);[\s\S]*try \{[\s\S]*await onCreateConnection[\s\S]*\} catch \{[\s\S]*outcome = "failed";[\s\S]*if \(!releaseOperation\(operation\)\) return/);
  assert.match(finish, /await onCreateConnection\([\s\S]*Boolean\(target\.recoveryState\)/,
    "create Retry must identify itself so historical payload fallback cannot resurrect a tombstone");
  assert.match(finish, /outcome !== "complete"[\s\S]*outcome === "committed-pending"[\s\S]*Safely recorded/);
  assert.match(finish, /recoveryState: outcome === "committed-pending" \? "committed-pending" : "unconfirmed"/);
  assert.match(finish, /setSession\(\(current\) => current === target \? \{[\s\S]*\.\.\.current,[\s\S]*feedback,[\s\S]*notice: undefined,[\s\S]*recoveryState:/);
  assert.match(finish, /setSession\(\(current\) => current === target \? null : current\)/);
  assert.match(source, /const activeOperation = useRef<number \| null>\(null\)/);
  assert.match(source, /currentContextKey\.current === operation\.contextKey/);
  assert.match(source, /if \(!extensionRequest\) return;[\s\S]*extensionRequest\.contextKey !== contextKey[\s\S]*if \(busy \|\| activeOperation\.current != null\) return/);
  assert.match(source, /export interface ConnectionExtensionRequest \{[\s\S]*contextKey: string/);
  assert.match(source, /setSession\(\(current\) => current\?\.recoveryState \? current : null\)/,
    "chapter or package navigation must preserve the one stable recovery command");
  assert.match(source, /session\.recoveryState \? \(\s*<span className="marking-session-recovery">Recovery required<\/span>/,
    "an ambiguous or committed-pending session must expose recovery as status, not a false cancel action");
  assert.doesNotMatch(source, /disabled=\{busy \|\| Boolean\(session\.recoveryState\)\}/,
    "recovery status must not be rendered as a disabled action");
  assert.match(escape, /if \(session\?\.recoveryState\)[\s\S]*Recovery required[\s\S]*return;[\s\S]*if \(session\)/,
    "Escape must retain exact Retry before ordinary session cancellation");
  assert.match(read("src", "renderer", "components", "ScripturePage.tsx"), /setConnectionExtension\(\{[\s\S]*contextKey: currentMarkingContextKeyRef\.current/);
  assert.match(source, /busy[\s\S]*\? "Saving connection…"[\s\S]*: session\.feedback/);
  assert.match(source, /className="marking-session"[\s\S]{0,180}aria-busy=\{busy\}/);
  assert.ok(escape.indexOf("if (busy || activeOperation.current != null)") < escape.indexOf("if (session)"));
  assert.match(escape, /if \(busy \|\| activeOperation\.current != null\) \{[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*return;/);
  assert.match(source, /const activeSelectionNonce = selection\?\.nonce \?\? null/);
  assert.match(source, /if \(surface !== "rail" \|\| activeSelectionNonce == null \|\| tool \|\| tray != null \|\| !railIntentFocusReady\) return;/);
  assert.match(source, /\}, \[activeSelectionNonce, railIntentFocusReady, surface, tool, tray\]\);/);
  assert.match(source, /const chooseWash[\s\S]*if \(!selection\) \{[\s\S]*onRequestReadingFocus\(\);[\s\S]*setConsumingSelectionNonce\(nonce\);[\s\S]*applyTool\(next, selection\)/);
  assert.match(source, /const chooseConnection[\s\S]*if \(!selection\) \{[\s\S]*onRequestReadingFocus\(\);[\s\S]*setConsumingSelectionNonce\(nonce\);[\s\S]*applyTool\(next, selection\)/);
  assert.match(source, /marking-rail-status-copy">\{status \|\| railToolGuidance\}/);
});
