import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import type { ConnectionRecord } from "../src/core/annotations/types.js";
import {
  connectionLayoutSignature,
  mergeUnderlineLayer,
  orderActiveConnections,
  orderConnectionTicks,
} from "../src/renderer/components/ConnectionUnderlay.js";
import { leastScrollForMembers } from "../src/renderer/utils/connectionAttendScroll.js";
import {
  MAX_STACK,
  RULE,
  RULE_CAP,
  elementaryIntervals,
  runsAtDepth,
} from "../src/renderer/components/HighlightUnderlay.js";
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

/** Every renderer source file, so a retirement can be proved and not asserted. */
const rendererSources = (): { path: string; text: string }[] => {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(?:ts|tsx|css)$/.test(entry)) continue;
      out.push({ path: relative(repoRoot, full), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(repoRoot, "src", "renderer"));
  return out;
};

/**
 * Blank out comments while preserving line numbers, so a claim about code can
 * be made about code alone. The design rationale for the retirement is prose
 * and is allowed to survive; a `railRoving` is not.
 */
const withoutComments = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
  .replace(/(^|[^:\\/])\/\/[^\n]*/g, (line, keep: string) => keep + " ".repeat(line.length - keep.length));

/**
 * Every leaf rule in a stylesheet, as the cascade sees it: comments removed, so
 * a commented-out rule is absent, and nested inside at-rules, so a container or
 * media query cannot hide a declaration from inspection.
 */
const cssRules = (css: string): { selector: string; body: string }[] => (
  [...withoutComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim().replace(/\s+/g, " "),
    body: match[2]!.trim().replace(/\s+/g, " "),
  }))
);

const commentsOf = (text: string): { line: number; body: string }[] => (
  [...text.matchAll(/\/\*[\s\S]*?\*\/|(?:^|[^:\w/])\/\/[^\n]*/g)].map((match) => ({
    line: text.slice(0, match.index).split("\n").length,
    body: match[0].replace(/\s+/g, " ").trim(),
  }))
);

test("both production marking surfaces share one explicit mutation controller", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  // Two surfaces, and one component owns both: the floating palette for a
  // pointer, the bottom dock for a thumb. The count is part of the contract —
  // a third rendered surface must fail here before it can reach a reader.
  for (const surface of ["palette", "dock"] as const) {
    assert.match(source, new RegExp(`data-marking-surface="${surface}"`));
  }
  assert.equal(
    [...new Set([...source.matchAll(/data-marking-surface="([a-z-]+)"/g)].map(([, id]) => id))].sort().join(","),
    "dock,palette",
    "MarkingSurface must render exactly the two surviving surfaces",
  );
  assert.match(source, /if \(surface === "palette"\) \{/);
  assert.match(source, /const persistentSurface = surface === "dock";/);
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

/**
 * The retirement itself, held as a contract. Two surfaces is not a default that
 * a later change may quietly widen back to three: the union, the settings
 * boundary, the migration, the picker, and the renderer sources all have to
 * agree, and the two retired ids must be unreachable rather than merely unused.
 */
test("the retired marking surfaces leave no reachable trace", () => {
  const api = read("src", "renderer", "api.ts");
  const main = read("src", "electron", "main.ts");
  const settings = read("src", "renderer", "components", "SettingsPage.tsx");

  // 1. The union is exactly two members, in both declarations of it.
  assert.match(api, /export type MarkingSurface = "palette" \| "dock";/);
  assert.match(main, /markingSurface: "palette" \| "dock";/);
  const unions: [string, RegExp, string][] = [
    ["renderer api", /export type MarkingSurface = ("[a-z]+"(?: \| "[a-z]+")*);/, api],
    ["electron schema", /\n {2}markingSurface: ("[a-z]+"(?: \| "[a-z]+")*);/, main],
  ];
  for (const [label, pattern, source] of unions) {
    const union = pattern.exec(source);
    assert.ok(union, `${label} must declare the marking-surface union inline`);
    assert.deepEqual(
      union[1]!.split(" | ").map((member) => member.replace(/"/g, "")).sort(),
      ["dock", "palette"],
      `${label} must accept exactly two marking surfaces`,
    );
  }

  // 2. The settings boundary knows two ids, migrates the two retired ones
  //    rather than resetting them, and falls back to the palette.
  assert.match(main, /const MARKING_SURFACE_IDS = new Set<AppSettingsSchema\["markingSurface"\]>\(\[\s*"palette",\s*"dock",\s*\]\);/);
  assert.match(
    main,
    /const LEGACY_MARKING_SURFACE: Record<string, AppSettingsSchema\["markingSurface"\]> = \{\s*rail: "dock",\s*radial: "palette",\s*\};/,
    "a stored rail keeps a persistent surface and a stored radial keeps a floating one",
  );
  assert.match(main, /if \(typeof value === "string" && LEGACY_MARKING_SURFACE\[value\]\) \{\s*return LEGACY_MARKING_SURFACE\[value\]!;/);
  assert.match(main, /: "palette";\s*\}/, "an unknown stored id must land on the palette");
  assert.equal(
    [...main.matchAll(/normalizeMarkingSurface\(/g)].length,
    4,
    "the migration must run at its definition and at all three settings boundaries: legacy adoption, load, and set",
  );

  // 3. The picker offers two, and describes each by the pointer it is for.
  const pickerStart = settings.indexOf("const MARKING_SURFACES:");
  const picker = settings.slice(pickerStart, settings.indexOf("];", pickerStart));
  assert.ok(pickerStart >= 0, "the settings picker must still enumerate the surfaces it offers");
  assert.match(picker, /\{ id: "palette",[\s\S]*?For a pointer\./);
  assert.match(picker, /\{ id: "dock",[\s\S]*?in reach of a thumb\./);
  assert.equal(
    [...picker.matchAll(/\{ id: "([a-z]+)"/g)].map(([, id]) => id).sort().join(","),
    "dock,palette",
    "the settings picker must not offer a surface the union no longer has",
  );

  // 4. The retired QA tours went with the surfaces they drove.
  for (const script of ["qa-marking-rail.mjs", "qa-marking-radial.mjs"]) {
    assert.equal(existsSync(join(repoRoot, "scripts", script)), false, `${script} must be gone`);
  }
  const pkg = read("package.json");
  assert.doesNotMatch(pkg, /qa:marking-(?:rail|radial)/);
  assert.match(pkg, /"qa:marking-palette"/);
  assert.match(pkg, /"qa:marking-dock"/);

  // 5. Nothing in the renderer may still reach for a retired surface. Comments
  //    are excluded here on purpose — the rationale for the retirement is
  //    prose, and prose is checked separately below.
  const retiredCode: { pattern: RegExp; why: string }[] = [
    { pattern: /data-marking-surface="(?:rail|radial)"/, why: "renders a retired surface" },
    { pattern: /surface\s*[!=]==\s*"(?:rail|radial)"/, why: "branches on a retired surface" },
    { pattern: /marking-(?:rail|radial)[a-z-]*/, why: "names a retired surface's class or host" },
    { pattern: /data-(?:rail|radial)-[a-z-]+/, why: "publishes a retired surface's state attribute" },
    { pattern: /\b(?:rail|radial)[A-Z]\w*/, why: "keeps a retired surface's state, ref, or helper" },
    { pattern: /\b(?:Rail|Radial)[A-Za-z]*\b/, why: "keeps a retired surface's identifier" },
    { pattern: /(?<![\w-])(?:"rail"|"radial"|'rail'|'radial')/, why: "keeps a retired surface id as a literal" },
  ];
  const leftovers: string[] = [];
  for (const { path, text } of rendererSources()) {
    withoutComments(text).split("\n").forEach((line, index) => {
      for (const { pattern, why } of retiredCode) {
        const hit = pattern.exec(line);
        if (!hit) continue;
        leftovers.push(`[code]  ${path}:${index + 1}  ${why}: ${hit[0]}  —  ${line.trim().slice(0, 96)}`);
        return;
      }
    });
  }

  // 6. Nor may the renderer still describe itself as having four surfaces. The
  //    one exception is api.ts, which documents why there are now two — the
  //    reasoning is worth keeping, and it is the only place that keeps it.
  const retiredProse: RegExp[] = [
    /\bPen Rail\b/,
    /\bRail\b/,
    /\bRadial\b/,
    /\brail·|\bradial·/,
    /\bradial\b(?!-gradient)(?=[\s\S]*?(?:palette|dock|tray|petal|surface))/i,
    /\bfour (?:physical |production )?(?:marking|surfaces|presentations|systems)\b/i,
  ];
  for (const { path, text } of rendererSources()) {
    if (path === join("src", "renderer", "api.ts")) continue;
    for (const { line, body } of commentsOf(text)) {
      if (!retiredProse.some((pattern) => pattern.test(body))) continue;
      leftovers.push(`[prose] ${path}:${line}  ${body.slice(0, 104)}`);
    }
  }

  // 7. The selection model may not keep measuring geometry for a surface that
  //    no longer exists. `proseBox` existed so the Radial could prefer the
  //    page's quiet side air, and `focusBox` so it could dodge the last
  //    painted fragment; both are measured on every selection change and must
  //    now be read by a surviving surface or not measured at all.
  const marking = read("src", "renderer", "components", "MarkingSurface.tsx");
  const positionType = marking.slice(
    marking.indexOf("  position: {"),
    marking.indexOf("  capture: MarkingSelectionCapture;"),
  );
  assert.match(positionType, /anchorBox:/, "the selection model must still describe its anchor geometry");
  for (const [, name] of positionType.matchAll(/^\s{4}(\w+Box):/gm)) {
    if (new RegExp(`position\\.${name}\\b`).test(marking)) continue;
    leftovers.push(`[dead]  src/renderer/components/MarkingSurface.tsx  position.${name} is measured for every selection and read by nobody`);
  }

  assert.deepEqual(
    leftovers,
    [],
    `the retired marking surfaces left ${leftovers.length} trace(s) behind:\n${leftovers.join("\n")}`,
  );
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

test("reading canvas mounts routed connections, one shared margin inspector, and two stage-responsive surfaces", () => {
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
  // Exactly two hosts, one per surviving surface, and they respond to the
  // stage in two different registers: the palette is a fixed floating layer
  // that lets the page through, the dock is a shelf the stage itself owns.
  assert.match(styles, /\.marking-floating-host \{[\s\S]*?position: fixed;[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.marking-dock-host \{[\s\S]*?position: absolute;/);
  assert.match(styles, /\.marking-floating-host\[data-palette-layout="sheet"\] \.marking-palette \{/);
  assert.deepEqual(
    [...new Set([...styles.matchAll(/\.marking-[a-z-]*?-host\b/g)].map(([match]) => match))].sort(),
    [".marking-dock-host", ".marking-floating-host"],
    "the retired rail and radial hosts must leave no stage-responsive rules behind",
  );
  // Source geometry only. The surviving palette measures its own rendered
  // footprint against the stage rather than trusting a synthetic estimate.
  assert.match(page, /anchorBox: \{ \.\.\.box \},/);
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
  assert.match(page, /const handleSelectConnection = useCallback\(async \([\s\S]{0,180}connection: ConnectionRecord \| null,[\s\S]*visibleConnectionByIdRef\.current\.get\(connection\.id\)[\s\S]*!await requestScriptureWorkspaceAttention\(\)[\s\S]*replaceHeldConnectionIds\(\[\.\.\.heldConnectionIdsRef\.current, visibleConnection\.id\]\)[\s\S]*onEnsureMarginVisible\?\.\(\);/,
    "canvas attention must await the Scripture-tab transition before changing held routes or focus");
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
  assert.doesNotMatch(card, /autoFocus/,
    "opening the inspector must stay focus-neutral; only the explicit exit decision may move focus");
  assert.match(card, /const runUpdate = async[\s\S]*try \{[\s\S]*await onUpdate\([\s\S]*catch \{[\s\S]*finally \{[\s\S]*requestInFlightRef\.current = false;[\s\S]*setBusy\(false\)/);
  assert.match(card, /const runDelete = async[\s\S]*try \{[\s\S]*await onDelete\([\s\S]*catch \{[\s\S]*finally \{[\s\S]*requestInFlightRef\.current = false;[\s\S]*setBusy\(false\)/);
  // Unchanged assertion, moved surface: the authored row it guards used to be
  // the `.margin-authored-connections` strip above the tab row, which is
  // retired — it drew the Connections tab's own dataset a second time and made
  // the tab row move when a chapter gained its first connection (§C4·1). The
  // row is now the Connections tab's `.margin-connection-row`, and the
  // requirement it carries is identical.
  assert.match(margin, /onClick=\{\(\) => onSelectAuthoredConnection\?\.\(connection, true\)\}/,
    "an authored row must hand both pointer and keyboard focus to the persistent inspector entry point before it unmounts");
  assert.match(margin, /lastConnectionInspectorFocusRequestRef[\s\S]*connectionInspectorFocusRequest[\s\S]*if \(!connectionInspectorOpen\) return;[\s\S]*frameTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
    "an explicit inspector-entry request must focus the persistent Study heading");
  // The start anchor was `const connectionInspectorWasOpenRef`, which the
  // margin renamed to `connectionInspectorOpenRef`. `indexOf` returned -1 and
  // `slice(-1, …)` is not an error, so this scope silently collapsed to the
  // empty string and the `doesNotMatch` below passed unconditionally. Both ends
  // are now checked before the cut, so a future rename fails loudly here rather
  // than quietly retiring the assertion.
  const inspectorOpenStart = margin.indexOf("const connectionInspectorOpenRef");
  const inspectorOpenEnd = margin.indexOf("const lastConnectionInspectorFocusRequestRef");
  assert.ok(inspectorOpenStart >= 0,
    "the margin no longer declares connectionInspectorOpenRef — re-anchor this scope before trusting the assertion below");
  assert.ok(inspectorOpenEnd > inspectorOpenStart,
    "the explicit inspector-entry effect must follow the open-state ref; without that order this slice scopes nothing");
  const inspectorOpenEffect = margin.slice(inspectorOpenStart, inspectorOpenEnd);
  assert.doesNotMatch(inspectorOpenEffect, /frameTitleRef\.current\?\.focus/,
    "opening from the reading canvas must not steal focus without an explicit inspector-entry request");
  // REWRITTEN by Quire §C4·1. This asserted `aria-describedby="living-margin-mode"`
  // on the Study heading. It was there because the heading said the word
  // "Study" and had to borrow the scope line to say anything true; the scope
  // line was a separate 11px band beside it. The heading is now the scope line
  // itself — `Acts 19:1–2 selected` — so what was the description is the name,
  // and an aria-describedby pointing at its own descendant would only make a
  // screen reader say the state word twice. The mode keeps its id, because the
  // stylesheet and the live region both still address it.
  assert.doesNotMatch(margin, /aria-describedby="living-margin-mode"/);
  assert.match(margin, /id="living-margin-title"\n\s*className="margin-frame-scope"/);
  assert.match(margin, /<span id="living-margin-mode" className="margin-frame-mode">\{scopeState\}<\/span>/);
  assert.match(margin, /id="living-margin-mode"[\s\S]*aria-live="polite"/);
  assert.match(styles, /\.connection-card \{[\s\S]*width: min\(340px, 100%\);[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
  assert.match(styles, /\.connection-card \{[\s\S]*padding: 12px 14px 10px;[\s\S]*border: 1px solid var\(--border-subtle\);[\s\S]*border-radius: var\(--radius-md\);[\s\S]*background: var\(--bg-reading\);[\s\S]*box-shadow: none;/);
  // Material applies to canvas, never to paper. The connection card is
  // floating paper, so it keeps one opaque fill in every atmosphere rather
  // than a per-theme translucent variant.
  assert.doesNotMatch(styles, /\.theme-glass \.connection-card|\.theme-dark-glass \.connection-card/);
  assert.doesNotMatch(styles, /\.material-translucent[^{]*\.connection-card[^{]*\{[^}]*background:/);
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

test("ConnectionCard registers one deduplicated fail-closed authored exit controller", () => {
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");

  assert.match(card, /onExitControllerChange\?: \(controller: WorkspaceExitController \| null\) => void/);
  assert.match(card, /onExitControllerChange\?\.\(exitController\)[\s\S]*onExitControllerChange\?\.\(null\)/,
    "the selected card must register and unregister exactly one workspace owner");
  assert.match(card, /if \(exitGuardPromiseRef\.current\) return exitGuardPromiseRef\.current/,
    "concurrent transition attempts must share the open decision and its eventual outcome");
  assert.match(
    card,
    /requestInFlightRef\.current[\s\S]*queuedCardEditRef\.current != null[\s\S]*updateCommandRef\.current != null[\s\S]*deleteCommandRef\.current != null[\s\S]*conflictReviewRef\.current != null[\s\S]*ambiguousMutation != null[\s\S]*recovery != null[\s\S]*return Promise\.resolve\(false\)/,
    "queued, in-flight, update, delete, conflict, ambiguous, and recovery ownership must all fail closed",
  );
  assert.match(card, /if \(!labelChanged && !observationChanged\) return Promise\.resolve\(true\)/,
    "a clean card must let the workspace transition proceed without prompting");
});

test("ConnectionCard exit Save sends one combined payload and approves only confirmed completion", () => {
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");
  const saveStart = card.indexOf("const saveCardForExit");
  const saveEnd = card.indexOf("const requestCardExit", saveStart);
  const save = card.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0 && saveEnd > saveStart, "missing the dedicated card-exit save path");
  assert.match(save, /const next: ConnectionRecordV2 = \{[\s\S]*label,[\s\S]{0,160}observation: draftObservationRef\.current/,
    "label and observation drafts must travel in the same whole-record update");
  assert.equal([...save.matchAll(/runUpdate\(pendingCommand\)/g)].length, 1,
    "the exit save must issue one exact update command");
  assert.match(save, /const complete = await runUpdate\(pendingCommand\)[\s\S]*return complete/);
  assert.doesNotMatch(save, /\bcommit\(/,
    "commit() reports command ownership, not confirmed authored completion");
});

test("ConnectionCard exit choices preserve Keep editing and explicit Discard semantics", () => {
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");

  assert.match(card, />Save changes<\/button>/);
  assert.match(card, />Discard<\/button>/);
  assert.match(card, />Keep editing<\/button>/);
  assert.match(card, /setDraftLabel\(displayTitle\(latestConnectionRef\.current\)\)[\s\S]*setDraftObservation\([\s\S]*latestConnectionRef\.current\.observation/,
    "Discard must restore both fields from the latest authoritative connection");
  assert.match(card, /settleCardExit\(false, \{ restoreFocus: true \}\)/,
    "Keep editing must preserve the draft and restore the pre-decision focus target");
  assert.match(card, /data-dirty=\{labelChanged \|\| observationChanged\}/,
    "real Electron QA needs a stable card-level dirty state while a transition is vetoed");
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
  // REWRITTEN 2026-07-30 by the connections revival — a dated reversal of
  // Rev 04 §5's one-weight ruling. Rev 04 drew rest and attend at 1.5px
  // ("attention changes ink and nothing else") and this block pinned the
  // quiet widths out of use. The reader has since ruled the Era-3 C0.5 paint
  // (the Smart Shapes checkpoint, 64d0e5f) the canon for connections, and its
  // stroke ladder returns: quiet ink is a 1px whisper on the underline and a
  // 1.25px route base, attention takes both to 1.5px SYMMETRICALLY about the
  // fixed centre datum — the datum never moves, which is the precision half
  // of the canon and stays pinned above. The constants never left
  // connectionGeometry.ts; the overlay feeds all four again.
  assert.match(styles, /\.connection-underline \{[\s\S]{0,700}stroke-width: var\(--connection-underline-quiet-width, 1px\)/,
    "a woken quiet run rests at the Era-3 1px whisper");
  assert.match(styles, /\.connection-underline\.attended \{[\s\S]{0,300}stroke-width: var\(--connection-underline-selected-width, 1\.5px\)/,
    "attended runs take 1.5px symmetrically about the datum");
  assert.match(styles, /\.connection-route \{[\s\S]{0,500}stroke-width: var\(--connection-route-quiet-width, 1\.25px\)/);
  assert.match(styles, /\.connection-mark\.focused \.connection-route \{[\s\S]{0,200}stroke-width: var\(--connection-route-selected-width, 1\.5px\)/,
    "the one drawn route is always focused, so it always renders at 1.5px");
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
  // REWRITTEN 2026-07-30 by the connections revival: the focus veil returns
  // from 64d0e5f — a dated reversal of Rev 04 §5's deletion ("every other
  // member stays ink-faint and does not dim"). The reader ruled the Era-3
  // atmosphere the canon, and the veil is its deepest breath. What is pinned
  // now is its discipline rather than its absence: it exists only under an
  // explicit selection with exact paint; the attended words keep full ink
  // through a black luminance hole; a held companion keeps most of its ink
  // through a grey one; and only the null -> selected transition fades it in,
  // so A -> B re-cuts holes without pulsing the reading field.
  assert.match(source,
    /selectedConnectionId && focusHasExactPaint && <rect[\s\S]{0,240}connection-focus-veil\$\{veilReady \? " is-ready" : ""\}/,
    "the veil exists only inside an explicit selection with exact paint");
  assert.match(source, /fill="rgb\(164 164 164\)"/,
    "a held companion keeps most of its ink through a grey hole");
  assert.match(source, /d=\{emphasis\.routePath\}\s*fill="black"/,
    "the attended words keep full ink through a black hole");
  assert.match(source, /if \(!hasSelectedRoute\) \{\s*setVeilReady\(false\)/,
    "only the null -> selected transition fades the veil in");
  // Rev 04's route discipline is deliberately KEPT by the revival: exactly one
  // route is ever drawn, and it is the attended one. A companion's presence is
  // its wash, its quiet merged runs, and its grey veil hole — never a second
  // centerline.
  assert.match(
    source,
    /selectedConnectionId != null\s*&& isDurablePaintRecord\(item\.connection\)\s*&& item\.connection\.id === selectedConnectionId/,
    "exactly one route is drawn, and it is the attended one",
  );
  assert.match(source, /item\.valid && item\.routePath && <path[\s\S]*className="connection-route-hit"/);
  assert.match(source, /data-paint-state=\{paintState\}/);
  // The wash survives on this plane for the two transient live-selection
  // states and for nothing else — see the Law 5 rewrite below.
  assert.match(source, /className="connection-emphasis-wash"/);
  assert.match(source, /data-line-count=\{emphasis\.bands\.length\}/);
  assert.match(source, /const renderedFragments = mergeRenderedLines\(fragments\.map[\s\S]*fragments: renderedFragments/);
  assert.match(source, /const sides: RouteSide\[\] = block\.preferredMargin === "right"[\s\S]*\["right", "left"\][\s\S]*\["left", "right"\]/);
  // Rev 04's flattening is deliberately KEPT by the revival: underlines never
  // stack, no run is ever offset off the centre datum, and a phrase in three
  // connections carries one stroke. What the revival changes (2026-07-30) is
  // WHEN the layer paints and WHAT ink a run carries: Era-3 rest is the wash
  // alone, so the merged layer wakes with a selection; a woken run resolves
  // exactly one ink — the attended kind's seal, a sole quiet owner's kind, or
  // neutral faint where quiet owners share.
  assert.doesNotMatch(source, /data-underline-level|companionLevel|CONNECTION_UNDERLINE_LEVEL_GAP/,
    "an underline is never offset to make room for another");
  assert.doesNotMatch(source, /transform=\{offsetY/, "no underline moves off the centre datum");
  assert.match(source, /const underlineLayer = selectedConnectionId == null \? \[\] : mergeUnderlineLayer\(/,
    "the rule layer wakes with a selection; Era-3 rest is the wash alone");
  assert.match(source, /\|\| heldConnectionIds\.includes\(item\.connection\.id\)\)\),\s*selectedConnectionId,\s*durableKindById,/,
    "the woken layer holds the attended connection and its held companions, with the kind table riding along");
  assert.match(source, /data-underline-ink=\{underline\.attended \? "seal" : underline\.kind \? "kind" : "faint"\}/);
  assert.match(source, /data-underline-members=\{underline\.memberIds\.length\}/);
  assert.match(source, /data-underline-center=\{underline\.centerY\.toFixed\(2\)\}/);
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
  // RESTATED 2026-07-31 by the Old Testament connection fix. This line read
  // `assert.match(marking, /paintAnchors: \[\.\.\.base\.paintAnchors, \.\.\.current\.paintAnchors\]/)`
  // — the in-flight draft always painted the reader's raw drag. It now paints
  // what the ANCHOR holds: when the canonical unit settles wider than the drag
  // (one Hebrew word rendering as "In the beginning"), the settled fragments
  // are the honest paint and the raw drag would be a lie. The claim the
  // contract still enforces is unchanged in substance — the draft paints
  // package-local fragments accumulated onto the session, never a durable
  // record.
  assert.match(marking, /const heldPaintAnchors = current\.capture\.settledPaintAnchors \?\? current\.paintAnchors/);
  assert.match(marking, /paintAnchors: \[\.\.\.base\.paintAnchors, \.\.\.heldPaintAnchors\]/);
  assert.match(marking, /onConnectionDraftChange\(connectionDraft\)/);
  assert.match(page, /const \[connectionDraft, setConnectionDraft\] = useState<ConnectionDraftModel \| null>\(null\)/);
  assert.match(page, /draftConnection=\{connectionDraft\?\.contextKey === `\$\{sessionOwnerTabId\}:\$\{book\}:\$\{chapter\}:\$\{packageId\}` \? connectionDraft : null\}/);
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
  // REWRITTEN 2026-07-30 by the connections revival: `sharedEmphasisPaint`
  // returns from 64d0e5f — a dated reversal of Rev 04 §5, which had moved
  // overlap into the gutter count alone. The count STAYS in the gutter; the
  // gold band returns beside it because the reader ruled the Era-3 atmosphere
  // the canon, and shared words reading gold at rest is part of it. The
  // dormant washes are knocked out beneath the band so the gold reads clean.
  assert.match(underlay, /const sharedPaint = sharedEmphasisPaint\(\s*visiblePainted\.filter\(\(item\) => isDurablePaintRecord\(item\.connection\)\),\s*\)/);
  assert.match(underlay, /className="connection-emphasis-shared"/);
  assert.match(underlay, /paintState === "dormant" && sharedPaint\.length > 0\s*\? \{ mask: `url\(#\$\{sharedMaskId\}\)` \}/,
    "dormant washes are knocked out under the gold band");
  assert.match(underlay, /isDurablePaintRecord\(item\.connection\)\s*&& item\.connection\.id === selectedConnectionId/);
  assert.match(underlay, /onSelectConnection\(item\.connection\.durableRecord, event\.detail === 0\)/);
  assert.doesNotMatch(underlay, /onSelectConnection\(selected \? null/,
    "tick activation reaffirms focus; only the labelled card action releases a hold");
  // REWRITTEN 2026-07-30 by the connections revival: the full Era-3
  // paint-state ladder returns to this plane — selection, authoring,
  // selected, needs-space, preview, companion, dormant — because the wash
  // ladder is the atmosphere the reader ruled canon, and every state of it
  // washes in its kind's ink. (Rev 04's Law 5 had collapsed the ternary to
  // the two live-selection states.)
  assert.match(underlay, /const paintState = markingSelection \? "selection"\s*: authoring \? "authoring"\s*: focused \? \(item\.valid \? "selected" : "needs-space"\)\s*: previewed \? "preview"\s*: companion \? "companion" : "dormant"/);
  assert.match(underlay, /const previewed = selectedConnectionId == null && item\.connection\.id === previewConnectionId/,
    "preview wakes only while nothing is selected");
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
  assert.match(source, /markingSurface: normalizeMarkingSurface\(settled\.markingSurface\)/);
  assert.match(source, /markingSurface: normalizeMarkingSurface\(partial\.markingSurface \?\? store\.store\.markingSurface\)/);
});

test("production marking surfaces retain distinct grammar at the supported desktop width", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const styles = read("src", "renderer", "styles.css");
  const paletteStart = source.indexOf('if (surface === "palette") {');
  const dockStart = source.indexOf("const dockState = busy", paletteStart);
  const palette = source.slice(paletteStart, dockStart);
  const dock = source.slice(dockStart);
  assert.ok(paletteStart >= 0 && dockStart > paletteStart, "both surface branches must remain locatable");

  // --- One bar, and its contents do not move ---------------------------------
  // Five swatches, then Note · Connect · More. Remove takes Note's slot when
  // the selection already carries a mark, and nothing else moves — a bar whose
  // contents shuffle cannot be used without looking at it first. Both surfaces
  // render the SAME component, so the constancy is structural rather than a
  // pair of layouts that happen to agree today.
  assert.match(source, /function MarkingBar\(\{[\s\S]*PIGMENTS\.map/);
  assert.equal([...source.matchAll(/<MarkingBar\b/g)].length, 1,
    "one bar component, rendered once and shared by both surfaces");
  assert.match(source, /const barNode = selection \? \(\s*<MarkingBar[\s\S]*selectedWash=\{currentWash \?\? selectedWash\}/);
  assert.match(palette, /\{connectNode \?\? failureNode \?\? barNode\}/,
    "the palette's working area holds exactly one thing at a time");
  assert.match(dock, /\{connectNode \?\? failureNode \?\? barNode \?\?/,
    "the dock's working area holds the same one thing, in the same order");
  assert.match(source, /hasExistingHighlight \? \([\s\S]{0,400}data-bar-action="remove"[\s\S]*?\) : \([\s\S]{0,400}data-bar-action="note"/,
    "Remove takes Note's slot; it never earns a sixth control of its own");
  assert.deepEqual(
    [...source.matchAll(/data-bar-action="([a-z-]+)"/g)].map(([, id]) => id),
    ["highlight", "remove", "note", "connect", "more", "more"],
    "the bar publishes exactly the five swatches and the three named slots",
  );
  assert.match(source, /data-relationship-kind=\{option\.id\}/);
  assert.match(source, /data-pigment=\{option\.id\}/);
  assert.doesNotMatch(source, /progressivePalette/);

  // --- Eleven actions, three kinds, one table -------------------------------
  // The table is the only place that decides which action is immediate,
  // deferred or modal, and which of them earns a permanent slot. A new action
  // cannot award itself the bar by being written closer to the render.
  const actionTable = source.slice(
    source.indexOf("const MARKING_ACTIONS:"),
    source.indexOf("] as const;", source.indexOf("const MARKING_ACTIONS:")),
  );
  assert.ok(actionTable.length > 0, "the action set must be declared as one table");
  const declared = [...actionTable.matchAll(/id: "([a-z-]+)", kind: "(immediate|deferred|modal)", label: "[^"]+", home: "(bar|more)"/g)]
    .map(([, id, kind, home]) => ({ id, kind, home }));
  assert.deepEqual(
    declared.filter(({ kind }) => kind === "immediate").map(({ id }) => id),
    ["highlight", "remove"],
    "immediate acts and finishes",
  );
  // RESTATED 2026-07-30 — "Mark a pericope" is gone from the table. Its whole
  // content in this menu was the sentence "pericopes are edited from the
  // passage header", and a row that exists to say the work happens elsewhere
  // is a signpost, not an action. A pericope is also a property of a PASSAGE,
  // not of the words a reader has just dragged across, so the selection menu
  // was never its home. The passage header is.
  assert.deepEqual(
    declared.filter(({ kind }) => kind === "modal").map(({ id }) => id).sort(),
    ["connect"],
    "modal turns the surface into a workbench",
  );
  // "Pericope" is also the product's name, so the retirement is proved against
  // the things the action actually WAS — its id, its prop, its label and its
  // apology — and against code alone, since the prose that records why it went
  // has to be allowed to name it.
  const code = withoutComments(source);
  for (const trace of [/"pericope"/, /onPericope/, /Mark a pericope/, /pericopes are edited/]) {
    assert.doesNotMatch(code, trace, `the retired pericope action left ${trace.source} behind`);
  }
  assert.deepEqual(
    declared.filter(({ home }) => home === "bar").map(({ id }) => id),
    ["highlight", "remove", "note", "connect"],
    "only immediate belongs on the bar, plus Note on use and Connect as an entry point",
  );
  for (const { id, kind, home } of declared) {
    if (home !== "bar") continue;
    assert.ok(kind === "immediate" || id === "note" || id === "connect",
      `${id} is ${kind} and may not hold a permanent slot`);
  }

  // --- More SHOWS WHAT CAN BE DONE ------------------------------------------
  // RESTATED 2026-07-30. This used to read: "an item that cannot act shows an
  // em-dash and the reason rather than vanishing", on the argument that a list
  // which changes shape costs the reader the place they had learned. The
  // argument was true and the trade was wrong. Five of the six declared rows
  // arrived greyed, each with an apology printed beside it — "no writing sheet
  // is open in this window", "this passage is already the open tab" — in a
  // popover the reader had just summoned by touching the text. What that
  // teaches is not a place in a list; it is that the app is broken.
  //
  // What survives of the old contract is the part that was actually load
  // bearing: the declared ORDER. Rows never rearrange around each other. They
  // only stop being offered when this window cannot honour them, and they
  // return the moment it can.
  assert.match(source, /function MoreList\(\{[\s\S]*className="marking-more-scope"/,
    "More states the scope it will act on before it offers an action");
  assert.doesNotMatch(source, /blockedReason|marking-more-reason/,
    "no row may carry a printed reason: an action that cannot act is not offered");
  assert.match(source, /for \(const action of MORE_ACTIONS\) \{[\s\S]*const handler = handlers\[action\.id\];\s*if \(!handler\) continue;/,
    "the list is built by walking the declared table in order and skipping what has no host");
  assert.match(source, /if \(action\.id === "copy-reference"\) \{[\s\S]*items\.push\(/,
    "Copy is always offered, so More can keep its slot without ever opening onto nothing");
  assert.match(source, /`“\$\{quote\}”\\n— \$\{reference\}`/,
    "Copy always includes the reference");

  // --- Palette: a measured floating instrument for a pointer -----------------
  // Its whole grammar is that it comes to the words. It measures its own
  // rendered footprint, points at the anchor, flips, and falls back to a sheet
  // only when the stage cannot hold a floating panel — and it never touches
  // the page's own geometry to do any of it.
  assert.match(source, /const paletteLayoutHint = effectiveStageBounds\.width < 480 \|\| effectiveStageBounds\.height < 360 \? "sheet" : "floating"/);
  assert.match(palette, /data-palette-layout=\{paletteLayout\}/);
  assert.match(palette, /data-marking-surface="palette"/);
  assert.match(palette, /data-floating-layer="toolbar"/);
  assert.match(palette, /role="toolbar"\s*\n\s*aria-label="Mark selected text"/);
  assert.match(palette, /return createPortal\(content, document\.body\);/,
    "the palette is desk chrome above the page, not a member of the reading stage");
  assert.match(palette, /const placement = selection && palettePlacement\?\.nonce === selection\.nonce \? palettePlacement : null;/);
  assert.match(palette, /const paletteLayout = placement\?\.layout \?\? paletteLayoutHint;/);
  assert.match(palette, /marking-palette\$\{placement\?\.flipped \? " flipped" : ""\}\$\{placement \? " is-placed" : " is-measuring"\}/);
  assert.match(palette, /visibility: placement \? "visible" : "hidden"/,
    "an unmeasured palette must not paint in the wrong place first");
  assert.match(source, /const canOpenAbove = anchor\.top - gap - panelRect\.height >= effectiveStageBounds\.top \+ inset;/);
  assert.match(source, /const opensAbove = layout === "floating" && \(canOpenAbove \|\| !canOpenBelow\);/);
  assert.match(source, /const pointerX = Math\.min\(Math\.max\(anchorCenter - left, 16\), Math\.max\(16, width - 16\)\);/);
  // 8px of clear air above the words, and never over them.
  assert.match(source, /const gap = 8;/);
  // It never shrinks to fit. The placement arithmetic uses the panel's own
  // measured height, so a stage too short to hold it moves it rather than
  // clamping it into a scroller.
  assert.match(source, /const height = panelRect\.height;/);
  assert.doesNotMatch(source, /const height = Math\.min\(panelRect\.height/);
  // Scroll, outside click and Escape close it. A selection CHANGE does not:
  // dragging to extend must keep it open and following the words, so an
  // outside click that leaves live words selected is not a dismissal.
  assert.match(
    source,
    /window\.addEventListener\("scroll", onScroll, true\);\s*document\.addEventListener\("click", onClick\);/,
    "the palette closes on scroll and on a completed outside click",
  );
  assert.match(
    source,
    /const native = window\.getSelection\(\);\s*if \(native && !native\.isCollapsed && native\.toString\(\)\.trim\(\)\) return;/,
    "an outside click that still holds words is a drag to extend, not a dismissal",
  );
  // RESTATED 2026-07-30. This used to require a permanent three-item legend
  // under the bar — `1–5 colour · 0 remove · ⌘⇧M note` — printed at every
  // moment a reader had words selected. A shortcut is a label on the thing it
  // operates, not a manual beneath it, so the footer now shows ONE key, and
  // only while the control it belongs to is under the pointer or holds focus.
  // Nothing about the bindings changed: every control still declares its own
  // through aria-keyshortcuts, and the shortcuts sheet carries the full
  // reference, which is where a reference belongs.
  assert.match(palette, /<span className="marking-palette-key" aria-hidden="true">\s*\{paletteHelp\?\.key && <kbd>\{paletteHelp\.key\}<\/kbd>\}\s*<\/span>/);
  assert.match(source, /explain\(\{ \.\.\.option, key: `\$\{index \+ 1\}` \}\)/,
    "a swatch carries its own digit into the help line");
  assert.match(source, /const BAR_HELP: Record<"remove" \| "note" \| "connect" \| "more", PaletteHelp> = \{[\s\S]*key: "0"[\s\S]*key: "⌘⇧M"/,
    "Remove and Note carry theirs from one table");
  assert.doesNotMatch(source, /marking-palette-shortcuts/);
  assert.match(source, /aria-label="Add note"/);
  assert.match(palette, /aria-label="Close palette"/);
  assert.doesNotMatch(source, /marking-palette-pin/,
    "the bar is modal on a selection, so there is no tool to pin down between them");
  assert.match(palette, /data-tool-armed=\{toolKey\}/);
  assert.match(palette, /<MarkingRestHint stageBounds=\{effectiveStageBounds\} theme=\{theme\} \/>/,
    "the quietest surface must still announce itself once to a first-run reader");
  // The palette is non-modal: the host lets the page through and the rest of
  // the desk stays live, so it must never claim modality.
  assert.doesNotMatch(palette, /aria-modal/);
  assert.match(source, /id="marking-palette-help" className="marking-palette-help" aria-live="polite"/);
  // Every control on the bar answers the help line, not just the swatches:
  // the line is only worth one row of the footer if it is never blank while
  // the reader is on something.
  assert.equal([...source.matchAll(/onMouseEnter=\{\(\) => explain\(/g)].length, 5,
    "five bar controls carry their own help: the swatches and the three named slots");
  assert.match(source, /\{paletteHelp \? paletteHelp\.description/);
  assert.doesNotMatch(source, /paletteHelp \? `\$\{paletteHelp\.label\} · \$\{paletteHelp\.description\}`/);
  assert.match(
    source,
    /if \(activeSelectionNonce == null \|\| persistentSurface \|\| tool\) return;\s*if \(surface === "palette" && palettePlacement\?\.nonce !== activeSelectionNonce\) return;[\s\S]*?firstChoiceRef\.current\?\.focus\(\{ preventScroll: true \}\);[\s\S]*?\}, \[activeSelectionNonce, palettePlacement\?\.nonce, persistentSurface, surface, tool\]\);/,
    "palette autofocus must be keyed by selection nonce so exact-capture updates cannot steal moved focus",
  );
  assert.match(styles, /\.marking-palette \{[\s\S]*?position: fixed;[\s\S]*?width: min\(430px, calc\(var\(--mark-stage-width\) - 24px\)\);[\s\S]*?max-height: var\(--mark-palette-max-height\);/);
  assert.match(styles, /\.marking-palette::after \{[\s\S]*?left: var\(--mark-pointer-x\);[\s\S]*?transform: translateX\(-50%\) rotate\(45deg\);/);
  assert.match(styles, /\.marking-palette\.flipped \{ transform-origin: center top; \}/);
  assert.match(styles, /\.marking-floating-host\[data-palette-layout="sheet"\] \.marking-palette::after \{ display: none; \}/,
    "a sheet does not point at anything, so it must drop the pointer");
  assert.match(styles, /\.marking-floating-host\[data-stage-size="narrow"\] \.marking-palette-key \{ display: none; \}/);

  // --- Shared: one focus-ring modality across both surfaces ------------------
  assert.equal([...source.matchAll(/data-focus-ring=\{focusRingMode\}/g)].length, 2,
    "exactly two surfaces publish the focus-ring modality");
  assert.match(source, /window\.addEventListener\("pointerdown", markPointer, true\)[\s\S]*window\.addEventListener\("keydown", markKeyboard, true\)/);
  // This used to read `outline: 2px solid var(--study-gold-focus)`. Ruling 4·4
  // retires that: the wash composites to 1.60:1 on paper and 1.53:1 on the
  // canvas, under Law 6's 3:1 floor for a wordless mark, and "a wash at .4
  // cannot reach 3:1 and a keyboard user gets nothing". The assertion was the
  // retired thing, not the CSS — this rule is the one place the marking
  // surfaces state their keyboard ring, so pinning it to the wash was pinning
  // the defect. Rev 04 §4's grammar, at full strength, is what it now asserts.
  assert.match(styles, /\[data-marking-surface\]\[data-focus-ring="keyboard"\] :is\([\s\S]*?\):focus-visible \{\s*outline: 2px solid var\(--accent-seal\)/);
  assert.match(styles, /\[data-marking-surface\]\[data-focus-ring="pointer"\][\s\S]*:focus-visible \{[\s\S]*outline: none;/);
  assert.match(styles, /\[data-marking-surface="palette"\]\[data-focus-ring="keyboard"\] \.marking-palette \.marking-relationship:focus-visible/);
  assert.match(styles, /\[data-marking-surface="palette"\]\[data-focus-ring="keyboard"\] \.marking-armed-status button:focus-visible/);
  assert.match(styles, /\[data-marking-surface="dock"\]\[data-focus-ring="keyboard"\] \.marking-dock-context \.marking-relationship:focus-visible/);
  assert.deepEqual(
    [...new Set([...styles.matchAll(/\[data-marking-surface="([a-z-]+)"\]/g)].map(([, id]) => id))].sort(),
    ["dock", "palette"],
    "no stylesheet rule may address a retired surface id",
  );
  assert.doesNotMatch(styles, /\.marking-(?:palette|dock-context)[^\n]*:is\(:hover, :focus-visible, \.active\)/);
  // Escape dismisses the selection from one capture-phase owner, and the
  // palette's own close control routes through the same single exit.
  assert.match(source, /if \(event\.key !== "Escape" \|\| event\.defaultPrevented\) return;[\s\S]*onDismissSelection\(\)/);
  assert.match(source, /const dismissPalette = \(\): void => \{[\s\S]*onDismissSelection\(\);/);
  assert.match(source, /event\.key !== "Tab"[\s\S]*querySelectorAll<HTMLButtonElement>\(\s*"button:not\(:disabled\)",\s*\)/);
  // --- Connect replaces the bar, and survives its own failure ---------------
  // Four draft states, and the kind row does not exist before a second anchor
  // does: asking what the relation IS before a relation exists is a question
  // with no answer.
  assert.match(source, /type ConnectDraftState = "one-anchor" \| "two-anchors" \| "in-flight" \| "recovery"/);
  assert.match(
    source,
    /function connectDraftState\(session: ConnectionSession, busy: boolean\): ConnectDraftState \{\s*if \(session\.recoveryState\) return "recovery";\s*if \(busy\) return "in-flight";\s*return session\.anchors\.length >= 2 \? "two-anchors" : "one-anchor";/,
    "one function decides the draft's state, so no branch can invent a fifth",
  );
  assert.match(source, /const readOnly = state === "in-flight" \|\| state === "recovery";/,
    "an in-flight write freezes the fields it is writing; the bar itself stays");
  assert.match(
    source,
    /\{held >= 2 && \(\s*<ConnectKindChoices/,
    "the kind row appears with the second anchor, not before it",
  );
  // RESTATED 2026-07-30 — the kind is a WORD. Rev 04 §5 rules that "the kind is
  // carried by the word and by nothing else — never abbreviated, never
  // iconified, never colour-coded, always set in the UI sans", and the margin's
  // finished card has obeyed it since. The draft did not: it drew six
  // unlabelled pictograms and hued each one per kind, breaking the ruling
  // twice. Both are gone, and the draft now offers the same six words the card
  // does, in the same grammar.
  assert.doesNotMatch(withoutComments(source), /RelationshipGlyph/,
    "no pictogram may stand for a connection kind");
  assert.match(source, /className="marking-connect-kind"[\s\S]*>\{option\.label\}<\/button>/,
    "each kind renders as its own word and nothing else");
  assert.doesNotMatch(source, /marking-kind-\$\{option\.id/,
    "no per-kind hue class reaches the authoring surface");
  // Arity is read off the kind here exactly as the inspector reads it, so a
  // draft can never author a kind the card would immediately call invalid.
  assert.match(source, /const blocked = \(kind: ConnectionKind\): boolean => BINARY_KINDS\.has\(kind\) && held !== 2;/);
  assert.match(source, /data-arity-blocked=\{unreachable \? "" : undefined\}/);
  assert.match(source, /readOnly=\{readOnly\}/, "in-flight fields are read-only, not unmounted");
  assert.equal([...source.matchAll(/<textarea/g)].length, 1,
    "label and observation are ONE field");
  assert.match(source, /const splitDraftText = useCallback\([\s\S]*label: trimmed\.slice\(0, breakAt\)\.trim\(\),\s*observation: trimmed\.slice\(breakAt \+ 1\)\.trim\(\),/,
    "the single field splits at its first newline into the record's two columns");
  // Never dismissed optimistically. onMutationStateChange exists because this
  // write can fail, and a vanished bar has nowhere to put the failure.
  assert.match(source, /className="marking-session marking-connect-draft"/);
  assert.match(source, /const captureConnection[\s\S]*if \(busy \|\| session\?\.recoveryState\) return false;/,
    "an unconfirmed command must block new phrase capture until exact Retry");
  assert.doesNotMatch(source, /Use Retry or Cancel/,
    "recovery cannot offer cancellation after the commit boundary is ambiguous");
  assert.match(source, />Retry<\/button>\s*<button type="button" className="marking-session-action" onClick=\{onCopyText\}>/,
    "recovery offers Retry and Copy text, so the reader's words survive the failure");
  assert.doesNotMatch(source, /marking-armed-status/,
    "there is no armed tool between selections, so there is no armed status to show");

  // --- Dock: the same bar, on a shelf in reach of a thumb --------------------
  assert.match(dock, /data-marking-surface="dock"/);
  assert.doesNotMatch(dock, /createPortal/,
    "the dock belongs to the reading stage it reserves room inside");
  assert.match(source, /const dockLayout = effectiveStageBounds\.width <= 759 \? "stacked" : "shelf"/);
  assert.match(source, /className=\{`marking-dock\$\{dockEntranceComplete \? " is-entered" : ""\}`\}[\s\S]*event\.animationName === "marking-dock-in"[\s\S]*setDockEntranceComplete\(true\)/);
  assert.match(source, /data-dock-state=\{dockState\}[\s\S]*data-tool-armed=\{toolKey\}/);
  assert.match(source, /data-dock-action="retry"[\s\S]*onClick=\{retryFailure\}/);
  // The dock offers no mode group, no thumb and no per-surface intents: the
  // constancy of the bar is the point, and a second vocabulary here would
  // break it at exactly the width where the reader can least afford it.
  for (const gone of [/DOCK_MODES/, /marking-dock-thumb/, /data-dock-tool=/, /data-dock-intent/, /marking-dock-selection/]) {
    assert.doesNotMatch(source, gone, `the dock must not reintroduce ${gone.source}`);
  }
  assert.match(source, /setSession\(next\);\s*setTray\(null\);\s*setTool\(\{ type: "connect", kind \}\)/);
  assert.match(styles, /\.marking-dock \{[\s\S]*?width:\s*min\(1120px, 100%\);[\s\S]*?display:\s*flex;/);
  assert.match(styles, /\.marking-dock-modes \{[\s\S]*?position:\s*relative;[\s\S]*?grid-template-columns:\s*repeat\(5, 38px\)/);
  assert.match(styles, /\.marking-dock-thumb \{[\s\S]*?width:\s*var\(--mark-dock-width, 38px\);[\s\S]*?transform:\s*translateX\(var\(--mark-dock-x, 0px\)\)/);
  assert.match(styles, /\.marking-dock:not\(\.is-entered\) \{ animation: marking-dock-in 200ms both var\(--mark-spring-soft\); \}/);
  assert.match(styles, /\.marking-dock-context \.marking-choice-glyph \{[^}]*color:\s*var\(--text-tertiary\)/);
  assert.match(styles, /\.marking-dock-actions:empty \{ display: none; \}/);
  assert.match(styles, /\.marking-dock-mode\.active\.marking-kind-parallel > svg \{ color: var\(--mark-parallel\); \}/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock \{[\s\S]*?grid-template-areas:\s*"context actions" "modes modes"/);
  assert.match(styles, /\.scripture-reading-stage:has\(\.marking-dock-host\[data-dock-layout="stacked"\]\) \{\s*--mdock-bottom-inset:\s*120px;/);
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock:has\(> \.marking-dock-actions:empty\) \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-areas:\s*"context" "modes";[\s\S]*?column-gap:\s*0;/);
  // RESTATED 2026-07-30 — was `grid-template-columns: auto minmax(0, 1fr) auto
  // auto`, four columns for a draft laid out as a strip. At this width every
  // column was narrower than the phrase inside it, so the type wrapped
  // mid-phrase. The draft is one block set down the page in every host now.
  assert.match(styles, /\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock-context \.marking-session \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /@container reading-stage \(max-width: 430px\) \{[\s\S]*?\.marking-dock-hit \{ display: none; \}[\s\S]*?\.marking-dock-host\[data-dock-layout="stacked"\] \.marking-dock \{ column-gap: 8px; \}[\s\S]*?width:\s*220px;/);
  assert.match(styles, /@media \(any-pointer: coarse\) \{[\s\S]*?\.marking-dock-modes \{ width: 238px; grid-template-columns: repeat\(5, 44px\); \}[\s\S]*?data-dock-layout="stacked"\] \.marking-dock-modes \{ width: 228px; gap: 2px; \}/);
  assert.match(styles, /\.app-shell:has\(\.marking-dock-host\[data-dock-layout="shelf"\]\) \+ \.toast-container \{[\s\S]*?bottom:\s*calc\(104px/);
  assert.match(styles, /\.app-shell:has\(\.marking-dock-host\[data-dock-layout="stacked"\]\) \+ \.toast-container \{[\s\S]*?bottom:\s*calc\(144px/);
  assert.match(styles, /@media \(max-width: 979px\) \{[\s\S]*?\.scripture-body \{[\s\S]*?flex-direction:\s*column;[\s\S]*?\.scripture-body > \.scripture-reading-stage \{[\s\S]*?min-height:\s*0;[\s\S]*?\.scripture-body > \.living-margin \{[\s\S]*?position:\s*static;[\s\S]*?width:\s*100%;[\s\S]*?max-height:\s*calc\(var\(--margin-header-h\) \+ 44px\)/);
  assert.match(styles, /\.scripture-body > \.living-margin\[data-compact-expanded="true"\] \{[\s\S]*?max-height:\s*min\(58vh, 520px\)/,
    "the compact Study pane offers a second calm size instead of one cramped strip");
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
  assert.match(note, /if \(savingRef\.current\) return false;[\s\S]*const t = title\.trim\(\)/);
  assert.doesNotMatch(note, /title\.trim\(\) \|\| draft\.passageRef/);
});

test("marking keyboard movement separates vocabulary focus from committed choices", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const kindsStart = source.indexOf("function ConnectKindChoices");
  const kinds = source.slice(kindsStart, source.indexOf("interface PaletteHelp", kindsStart));
  assert.ok(kindsStart >= 0, "the kind chooser must remain locatable");

  // RESTATED 2026-07-30. `useRovingFocus` and `RelationshipChoices` are gone
  // with the pictograms they drew (Rev 04 §5: the kind is a word). What that
  // pair guaranteed still holds, and is now asserted of the one chooser that
  // remains: it is a radiogroup, the arrows MOVE and CHOOSE together, and the
  // walk steps OVER a kind that arity has put out of reach instead of landing
  // focus on a control that cannot answer.
  assert.match(kinds, /role="radiogroup" aria-label="Connection kind"/);
  assert.match(kinds, /role="radio"[\s\S]*aria-checked=\{selected === option\.id\}/);
  assert.match(kinds, /const reachable = RELATIONSHIPS\.map\(\(option, index\) => \(blocked\(option\.id\) \? -1 : index\)\)\.filter\(\(index\) => index >= 0\);/);
  assert.match(kinds, /const next = position < 0[\s\S]*reachable\[\(position \+ direction \+ reachable\.length\) % reachable\.length\]!/,
    "the arrow walk wraps through reachable kinds only");
  assert.match(kinds, /refs\.current\[next\]\?\.focus\(\);\s*onChoose\(RELATIONSHIPS\[next\]!\.id\);/,
    "moving to a kind chooses it, so the arrows never leave a phantom selection");
  assert.match(kinds, /tabIndex=\{tabIndexOwner === index \? 0 : -1\}/,
    "one tab stop for the group, and it is never a kind out of reach");
  assert.doesNotMatch(source, /useRovingFocus/);
  assert.match(source, /lastDockAutofocusedSelectionRef\.current === activeSelectionNonce[\s\S]*if \(tool \|\| tray != null \|\| session \|\| busy \|\| selectionFailure\?\.nonce === activeSelectionNonce\) return[\s\S]*lastDockAutofocusedSelectionRef\.current = activeSelectionNonce/);
  assert.match(source, /const timer = window\.setTimeout\(\(\) => \{[\s\S]*target\.focus\(\{ preventScroll: true \}\);[\s\S]*lastDockAutofocusedSelectionRef\.current = activeSelectionNonce;/);
  assert.match(source, /if \(surface !== "dock" \|\| busy \|\| !session\?\.feedback\) return;[\s\S]*\.marking-session-action\.primary:not\(:disabled\)[\s\S]*focus\(\{ preventScroll: true \}\)[\s\S]*\[busy, session\?\.feedback, surface\]/);

  // The bindings themselves. Bare digits are safe only because the bar is
  // modal on a selection: with no words held these listeners do not exist, so
  // the gate on `selection` is as much a part of the contract as the codes.
  assert.match(source, /if \(focusMode \|\| !selection \|\| session \|\| busy\) return;[\s\S]*window\.addEventListener\("keydown", onKeyDown, true\)/,
    "the digit bindings exist only while a selection makes them unambiguous");
  assert.ok(source.includes('const digit = /^Digit([0-5])$/.exec(event.code);'));
  assert.ok(source.includes('aria-keyshortcuts={`${index + 1}`}'), "each swatch advertises its own bare digit");
  assert.match(source, /aria-keyshortcuts="0"/, "Remove advertises 0");
  assert.match(source, /aria-keyshortcuts="Meta\+Shift\+M"/, "Note advertises ⌘⇧M");
  assert.match(
    source,
    /if \(index === 0\) \{\s*if \(selection\.hasExistingHighlight\) chooseErase\(\);/,
    "0 removes, and says so when there is nothing to remove",
  );
  assert.match(
    source,
    /if \(event\.shiftKey && \(event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"\)\)[\s\S]*extendSelectionByVerse\(event\.key === "ArrowDown" \? 1 : -1\)/,
    "⇧↑/↓ extends the selection by a whole verse",
  );
  assert.match(source, /const extendSelectionByVerse = useCallback\([\s\S]*\.verse-line\[data-verse\][\s\S]*\.verse-text-span/);
  assert.match(
    source,
    /if \(target instanceof HTMLElement && \([\s\S]*target\.isContentEditable[\s\S]*input, textarea, select, \[role='textbox'\][\s\S]*\)\) return;/,
    "a bare digit typed into the connection field is a digit, not a colour",
  );
});

test("the More list closes locally and restores its opener on Escape", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(source, /const trayPanelRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const trayOpenerRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(source, /const closeTray = useCallback\(\(restoreFocus: boolean\)[\s\S]*opener\?\.isConnected[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /const ownerContextKey = currentContextKey\.current;[\s\S]*currentContextKey\.current !== ownerContextKey/);
  // The bar is the one toolbar a lost opener can fall back into, and More is
  // the slot it came from — the bar's contents never move, so the fallback is
  // always the same control in the same place.
  assert.match(source, /const toolbar = dockModesRef\.current;/);
  assert.match(source, /const fallback = toolbar\?\.querySelector<HTMLButtonElement>\('button\[data-bar-action="more"\]'\)/);
  assert.match(source, /if \(tray !== "more"\) return;[\s\S]*document\.addEventListener\("mousedown", onMouseDown\)/);
  const escapeHandler = source.slice(source.indexOf("const onKeyDown = (event: KeyboardEvent)"), source.indexOf("window.addEventListener", source.indexOf("const onKeyDown = (event: KeyboardEvent)")));
  assert.ok(escapeHandler.indexOf("closeTray(true)") < escapeHandler.indexOf("if (activeSelectionNonce != null)"), "Escape must close the More list before dismissing the selection");
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
  assert.match(escapeHandler, /if \(tray === "more"\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)[\s\S]*closeTray\(true\)/);
  assert.match(escapeHandler, /if \(activeSelectionNonce != null\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)[\s\S]*onDismissSelection\(\)/);
  assert.match(source, /window\.addEventListener\("keydown", onKeyDown, true\)[\s\S]*window\.removeEventListener\("keydown", onKeyDown, true\)/);
});

// The Radial's scrim used to own this invariant, and the invariant outlived
// the surface: a gesture that ends outside a marking surface may only be acted
// on by the completed click, never by the pointer-down half — pointer-down is
// exactly when the browser would collapse the native selection the surface is
// still holding. Retiring the scrim does not retire the rule; it moves it.
test("outside dismissal still completes on the click, never on the pointer-down half", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");
  const page = read("src", "renderer", "components", "ScripturePage.tsx");

  // Neither surviving surface raises a shield at all, so there is nothing left
  // that could swallow a completing click: the palette host is a fixed layer
  // the page shows through, and the dock is a shelf beneath the measure.
  assert.doesNotMatch(source, /marking-[a-z-]*scrim/,
    "no surviving marking surface may interpose a shield between reader and words");
  const styles = read("src", "renderer", "styles.css");
  assert.match(styles, /\.marking-floating-host \{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.marking-palette \{[\s\S]*?pointer-events: auto;/,
    "only the panel itself takes the pointer; the stage around it stays live");
  assert.match(styles, /\.marking-dock \{[\s\S]*?pointer-events: auto;/);

  // Every pointer-down handler in the component exists for one reason: to stop
  // the press half of a gesture from collapsing the held selection. The action
  // itself always waits for the click.
  const pointerDownHandlers = [...source.matchAll(/onMouseDown=\{/g)].length;
  const neutralised = [...source.matchAll(/onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/g)].length
    + [...source.matchAll(/onMouseDown=\{\(event\) => \{ if \(!activateOnMove\) event\.preventDefault\(\); \}\}/g)].length;
  assert.equal(neutralised, pointerDownHandlers,
    "a marking control that handles mousedown must do nothing but neutralise it");
  assert.ok(pointerDownHandlers >= 7, "the surviving surfaces still guard every press");
  assert.doesNotMatch(source, /onPointerDown=/,
    "no marking control may act on pointerdown");

  // The More list's own outside-close is deliberately non-destructive: a press
  // outside it closes only the list, silently, and never consumes the
  // selection or restores focus behind the reader's back.
  const trayOutsideStart = source.indexOf("if (tray !== \"more\") return;\n    const onMouseDown");
  const trayOutside = source.slice(trayOutsideStart, source.indexOf("}, [closeTray, tray]);", trayOutsideStart));
  assert.ok(trayOutsideStart >= 0 && trayOutside.length > 0, "missing the More list's outside-close handler");
  assert.match(trayOutside, /trayPanelRef\.current\?\.contains\(target\) \|\| trayOpenerRef\.current\?\.contains\(target\)/);
  assert.match(trayOutside, /closeTray\(false\)/);
  assert.doesNotMatch(trayOutside, /onDismissSelection|onClearSelection/);

  // The destructive outside dismissal — releasing authored focus — is the one
  // that must survive the completing click, and it does: it listens for
  // "click", shields both surviving hosts, and stands down for a dirty card or
  // any higher floating layer.
  const outsideStart = page.indexOf('.connection-card[data-dirty="true"]');
  const outsideEnd = page.indexOf('document.addEventListener("click", handleOutsideClick)', outsideStart);
  const outside = page.slice(outsideStart, outsideEnd);
  assert.ok(outsideStart >= 0 && outsideEnd > outsideStart, "missing the authored outside-dismiss handler");
  assert.match(page, /document\.addEventListener\("click", handleOutsideClick\)/,
    "authored focus may only be released by a completed click");
  assert.match(outside, /"\.marking-floating-host",/);
  assert.match(outside, /"\.marking-dock-host",/);
  assert.match(outside, /\[data-floating-layer="dialog"\], \[data-floating-layer="popover"\]/);
  assert.ok(
    outside.indexOf('.connection-card[data-dirty="true"]') < outside.indexOf("handleDismissConnectionFocus()"),
    "a dirty card owns its own exit decision before any outside click can dismiss it",
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
    ".marking-dock",
  ]) {
    assert.match(ruleBlock(selector), /background:\s*var\(--bg-reading\);/, `${selector} must use a flat neutral base material`);
  }
  // Two surfaces, one material. Retiring the Radial retired the only gradient
  // any marking surface ever carried, so the section must now be gradient-free
  // apart from the palette's calibrated pigment mixes.
  assert.doesNotMatch(marking, /radial-gradient|linear-gradient\((?!100deg, var\(--hl-)/,
    "the surviving surfaces are flat neutral paper, not lit discs");
  // Every marking surface is floating paper, and material never applies to
  // paper — so neither carries a translucent variant. A palette you can see
  // the verse through is a palette you cannot read a swatch on.
  for (const selector of [".marking-dock", ".marking-palette"]) {
    assert.doesNotMatch(
      marking,
      new RegExp(`\\.material-translucent[^{]*\\${selector}[^{]*\\{[^}]*(background|backdrop-filter):`),
      `${selector} must stay opaque paper under the translucent material`,
    );
  }
  assert.doesNotMatch(marking, /\.theme-glass|\.theme-dark-glass/);
  assert.doesNotMatch(marking, /\.marking-icon-action\.danger:hover\s*\{[^}]*var\(--error\)/);
  const shortcutKeys = ruleBlock(".marking-palette-key kbd");
  assert.match(shortcutKeys, /border:\s*0;/);
  assert.match(shortcutKeys, /background:\s*transparent;/);
  assert.match(shortcutKeys, /box-shadow:\s*none;/);
  for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.ok(
      marking.includes(`.marking-palette .marking-pigment-${color} { background: color-mix(in srgb, var(--hl-${color}-mark) 46%, var(--bg-reading)); }`),
      `Palette ${color} pigment must reuse the calibrated flat 46% mix`,
    );
  }
  assert.match(ruleBlock(".marking-palette .marking-pigment"), /box-shadow:\s*none;/);
  assert.match(ruleBlock(".marking-dock .marking-pigment"), /box-shadow:\s*none;/);
  assert.match(marking, /\.marking-palette\.is-placed \{\s*--mark-palette-enter-y: 4px;\s*--mark-palette-enter-scale: \.955;\s*animation: marking-palette-in var\(--mark-dur-enter\) var\(--mark-spring\);/);
  assert.match(marking, /@keyframes marking-palette-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(var\(--mark-palette-enter-y\)\) scale\(var\(--mark-palette-enter-scale\)\);/);
  assert.match(marking, /\.marking-palette\.flipped\.is-placed \{ --mark-palette-enter-y: -4px; \}/);
  assert.match(marking, /data-palette-layout="sheet"\] \.marking-palette \{\s*--mark-palette-enter-y: 5px;\s*--mark-palette-enter-scale: \.985;/);
  assert.doesNotMatch(marking, /animation-name:\s*marking-palette|@keyframes marking-palette-(?:in-below|sheet-in)/);
  assert.equal([...marking.matchAll(/animation:\s*marking-palette-[\w-]+/g)].length, 1, "Palette variants must never introduce a second animation assignment");
  assert.equal([...marking.matchAll(/@keyframes marking-palette-in\s*\{/g)].length, 1, "Palette placement variants must share one entrance animation name");
  assert.match(marking, /data-dock-layout="stacked"[^}]*grid-template-areas:\s*"context actions" "modes modes"/);
  assert.match(marking, /data-dock-layout="stacked"[^}]*\.marking-dock-context \{[^}]*border-bottom:\s*1px solid var\(--border-subtle\)/);
  // Seven keyframes went out with the two surfaces. What is left is an exact
  // list, and every name on it is still animated by a live rule — a retired
  // surface must not leave an orphaned @keyframes behind for nobody.
  const keyframeNames = [...new Set([...marking.matchAll(/@keyframes ([\w-]+)/g)].map(([, name]) => name))].sort();
  assert.deepEqual(keyframeNames, [
    "marking-armed-in",
    "marking-dock-context-in",
    "marking-dock-in",
    "marking-dock-spin",
    "marking-palette-in",
    "marking-rest-hint-in",
    "marking-rise-in",
  ], "the marking section must declare one keyframe set, sized to two surfaces");
  for (const name of keyframeNames) {
    assert.match(
      marking,
      new RegExp(`animation(?:-name)?:[^;]*\\b${name}\\b`),
      `@keyframes ${name} is declared but nothing animates with it`,
    );
  }

  const thumbStart = marking.indexOf(".marking-dock-thumb {");
  const thumbEnd = marking.indexOf("}", thumbStart);
  const thumb = marking.slice(thumbStart, thumbEnd);
  assert.match(thumb, /background:\s*color-mix\([^;]*var\(--bg-reading\)\)/);
  assert.doesNotMatch(thumb, /--mark-(?:parallel|contrast|echo|mirror|series|hinge)|--hl-/);

  const reducedStart = marking.indexOf("@media (prefers-reduced-motion: reduce)");
  const forcedStart = marking.indexOf("@media (forced-colors: active)", reducedStart);
  const reduced = marking.slice(reducedStart, forcedStart);
  for (const selector of [".marking-palette", ".marking-armed-status", ".marking-dock", ".marking-dock-thumb", ".marking-dock-mode"]) {
    assert.ok(reduced.includes(selector), `${selector} must honor reduced motion`);
  }
  assert.match(marking, /@media \(prefers-reduced-motion: reduce\) \{\s*\.marking-rest-hint \{ animation: none; \}/,
    "the first-run hint must not animate for a reader who asked for stillness");
  assert.match(reduced, /animation:\s*none !important/);
  assert.match(reduced, /transition:\s*none !important/);

  const forced = marking.slice(forcedStart);
  assert.match(forced, /\.marking-pigment::after[^}]*content:\s*attr\(data-forced-code\)/);
  assert.match(forced, /\.marking-dock-thumb \{[^}]*display:\s*none/);
  assert.match(forced, /\[data-marking-surface="dock"\]\[data-focus-ring="keyboard"\] \.marking-dock-mode\.active:focus-visible \{ outline: 3px double Highlight/);
});

/**
 * The reason rail·side was disqualified, held as structure rather than as a
 * memory. It padded `.scripture-content` by 92px, so the reading measure MOVED
 * when a tool appeared — and the measure is the one thing that must hold still.
 * No surviving surface may reach the inline axis of the page, and the dock's
 * bottom inset is the dock's own layout arithmetic, not a token a theme or any
 * other surface may read.
 */
test("no marking surface may move the reading measure, and the dock's inset stays dock-internal", () => {
  const styles = read("src", "renderer", "styles.css");
  const rules = cssRules(styles);
  const marked = /\.marking-[a-z-]*host|\[data-marking-surface|\[data-(?:dock|palette)-layout|\[data-dock-state/;
  const measureTarget = /\.scripture-(?:content|inner|body|page)\b|\.verse-text\b/;

  // Anything on the inline axis moves the measure. Block-axis room below the
  // last verse does not: the line length is unchanged, so the words stay put.
  const inlineAxis = /(?:^|;)\s*(?:padding|margin|inset|border-width)\s*:|(?:^|;)\s*(?:padding|margin|inset|border)-(?:left|right|inline)(?:-start|-end)?(?:-width)?\s*:|(?:^|;)\s*(?:min-|max-)?width\s*:|(?:^|;)\s*(?:left|right|transform|translate|columns|column-width|--reading-inline-gutter|--reading-max-width|--page-gutter|--page-inset)\s*:/;
  const movesMeasure = rules
    .filter(({ selector }) => marked.test(selector) && measureTarget.test(selector))
    .filter(({ body }) => inlineAxis.test(body))
    .map(({ selector, body }) => `${selector}  {  ${body.slice(0, 120)}  }`);
  assert.deepEqual(
    movesMeasure,
    [],
    `a marking surface still moves the reading measure:\n${movesMeasure.join("\n")}`,
  );
  assert.doesNotMatch(
    styles,
    /\.scripture-content \{[^}]*padding-left:\s*92px|padding-left:\s*92px/,
    "the 92px side-Rail gutter must never come back",
  );

  // Exactly one marking-conditioned rule reaches the page at all, and it only
  // makes room below the words for the shelf that sits over them.
  const pageRules = rules.filter(({ selector }) => marked.test(selector) && /\.scripture-content\b/.test(selector));
  assert.equal(pageRules.length, 1, "only the dock may reserve room inside the page");
  assert.match(pageRules[0]!.selector, /^\.scripture-reading-stage:has\(\.marking-dock-host\) \.scripture-content$/);
  assert.match(pageRules[0]!.body, /^padding-bottom: calc\(80px \+ var\(--mdock-bottom-inset\)\); scroll-padding-bottom: calc\(24px \+ var\(--mdock-bottom-inset\)\);$/);

  // The inset is dock-internal: renamed off the theme-token surface, declared
  // only on the stage that hosts a dock, and read by that one rule alone.
  assert.doesNotMatch(styles, /--marking-bottom-inset/,
    "the dock's layout arithmetic must not read as a theme token");
  const insetDeclarations = rules.filter(({ body }) => /--mdock-bottom-inset\s*:/.test(body));
  assert.equal(insetDeclarations.length, 6,
    "one zero default, one per dock state, the narrow shell's flush dock, and the empty-handed rest");

  /* What reserves room is a dock that is THERE, which used to be the same thing
     as a dock that exists. Since 2026-07-29 it is not: at rest and empty-handed
     the dock is hidden, and a floor held open under a bar nobody can see is the
     doubled gap this file exists to prevent from the other direction. So one
     dock selector may legitimately reserve nothing, and it is exactly the pair
     of conditions that hides it — `rest` alone would close the page over a wash
     still in hand. */
  const HIDDEN = '.scripture-reading-stage:has(.marking-dock-host[data-dock-state="rest"][data-tool-armed="false"])';
  assert.ok(
    insetDeclarations.some(({ selector }) => selector === HIDDEN),
    "the state that hides the dock must also release its reservation",
  );

  for (const { selector, body } of insetDeclarations) {
    const value = /--mdock-bottom-inset:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (selector === ".scripture-reading-stage") {
      assert.equal(value, "0px", "a stage with no dock in it must reserve nothing");
      continue;
    }
    if (selector === HIDDEN) {
      assert.equal(value, "0px", "a hidden dock must reserve nothing either");
      continue;
    }
    assert.match(
      selector,
      /^\.scripture-reading-stage:has\(\.marking-dock-host[^)]*\)$/,
      `--mdock-bottom-inset may only take a value under a dock selector (${selector})`,
    );
    assert.notEqual(value, "0px");
  }
  const insetReaders = rules.filter(({ body }) => /var\(--mdock-bottom-inset/.test(body)).map(({ selector }) => selector);
  assert.deepEqual(
    insetReaders,
    [".scripture-reading-stage:has(.marking-dock-host) .scripture-content"],
    "nothing outside the dock's own room-making rule may read the dock's inset",
  );

  // Nor may any marking selector redefine the measure itself.
  const measureTokens = rules
    .filter(({ selector, body }) => marked.test(selector) && /--reading-(?:max-width|inline-gutter)\s*:/.test(body))
    .map(({ selector }) => selector);
  assert.deepEqual(measureTokens, [], `a marking selector redefines the measure: ${measureTokens.join(", ")}`);
});

/**
 * A deletion this size is done with an editor, and an editor can leave a rule
 * inside a comment or a selector with its head cut off. Text assertions cannot
 * see the difference — `assert.match(styles, /…/)` passes on a rule that the
 * cascade never reaches — so the structure has to be checked directly.
 */
test("the marking stylesheet is live CSS: no rule trapped in a comment, no orphaned selector", () => {
  const styles = read("src", "renderer", "styles.css");

  const trapped: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = styles.indexOf("/*", cursor);
    if (open === -1) break;
    const close = styles.indexOf("*/", open + 2);
    const line = styles.slice(0, open).split("\n").length;
    assert.notEqual(close, -1, `unterminated CSS comment opened at src/renderer/styles.css:${line}`);
    for (const [, rule] of styles.slice(open + 2, close).matchAll(/^[ \t]*([.#[@][^{}\n]*\{)/gm)) {
      trapped.push(`src/renderer/styles.css:${line}  swallowed by this comment: ${rule.trim().slice(0, 88)}`);
    }
    cursor = close + 2;
  }
  assert.deepEqual(
    trapped,
    [],
    `${trapped.length} CSS rule(s) are commented out and will never reach the cascade:\n${trapped.join("\n")}`,
  );

  // A selector whose parentheses do not balance is a selector the browser
  // discards whole — exactly what a half-deleted `:is(…)` list leaves behind.
  const orphaned: string[] = [];
  const stripped = withoutComments(styles);
  for (const match of stripped.matchAll(/([^{}]*)\{/g)) {
    const selector = match[1]!.trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@")) continue;
    const opens = (selector.match(/\(/g) ?? []).length;
    const closes = (selector.match(/\)/g) ?? []).length;
    if (opens === closes) continue;
    orphaned.push(`src/renderer/styles.css:${stripped.slice(0, match.index).split("\n").length}  ${selector.slice(0, 96)}`);
  }
  assert.deepEqual(
    orphaned,
    [],
    `${orphaned.length} selector(s) have unbalanced parentheses and are discarded whole:\n${orphaned.join("\n")}`,
  );

  // And the dock's own hue vocabulary must actually be live, not merely
  // present in the file: these are the rules that colour the active tool.
  const live = cssRules(styles).map(({ selector }) => selector);
  for (const selector of [
    ".marking-dock-mode:disabled",
    ".marking-dock-mode.active.marking-kind-parallel > svg",
    ".marking-dock-mode.active.marking-kind-hinge > svg",
    ".marking-dock-mode.active.tone-yellow > svg",
    ".marking-choice-panel",
  ]) {
    assert.ok(live.includes(selector), `${selector} is not a live rule in the cascade`);
  }
});

test("marking surface guidance stays contextual and quiet", () => {
  const source = read("src", "renderer", "components", "MarkingSurface.tsx");

  assert.match(source, /const REST_GUIDANCE = "Select words, or choose a tool to keep in hand\.";/);
  assert.match(source, /useState\(REST_GUIDANCE\)/);
  assert.doesNotMatch(source, /Read tool active\./);
  // The Radial announced its own geometry ("Connections arc above…"), which is
  // a sentence only a wheel could say. What replaces it is guidance about the
  // work, not the widget — and each surface says it in exactly one place.
  assert.doesNotMatch(source, /arc above|settle below/,
    "guidance describes the marking, never the shape of the instrument");
  // RESTATED 2026-07-30. The refusal used to come FIRST in this line, which
  // meant a reader who selected words in a translation without an exact word
  // index was handed a sentence about an uninstalled artifact before they had
  // asked for anything — while all they may have wanted was a wash. A refused
  // exact capture blocks Connect and nothing else, so it is now said at
  // Connect, through that control's own help, and nowhere else.
  assert.match(
    source,
    /\{paletteHelp \? paletteHelp\.description\s*: selection\.mixedColors \? "Mixed washes selected — choose one to unify them\."\s*: "Highlight, note, or connect these words\."\}/,
    "the palette's one live region answers hover help, then mixed washes",
  );
  assert.match(
    source,
    /const connectHelp: PaletteHelp = selection\?\.capture\.status === "refused"\s*\? \{ label: "Connect", description: selection\.capture\.message \}\s*: BAR_HELP\.connect;/,
    "the refusal is carried by the one action it actually blocks",
  );
  // Both surfaces read from the one `status` string, so guidance cannot drift
  // between them.
  assert.match(source, /className="marking-dock-resting"><span aria-hidden="true"><ToolGlyph tool="read" \/><\/span>\{status\}<\/span>/);
  assert.match(source, /<span className="sr-only" role="status" aria-live="polite">\{status\}<\/span>/,
    "the dock's status must also reach a screen reader that cannot see the shelf");
  // Guidance may never name an instrument a reader can no longer choose.
  assert.doesNotMatch(source, /"[^"\n]*\b(?:Rail|Radial|petal|wheel)\b[^"\n]*"/,
    "no user-visible string may mention a retired surface or its parts");
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

// The Pen Rail owned this invariant, and the invariant is about the broker, not
// the instrument: an async marking write must report exactly what happened, and
// a keyboard reader must be handed back to Scripture afterwards. Both surviving
// surfaces share the one controller that does it, so both must honour it.
test("marking async outcomes stay truthful and return keyboard focus to Scripture", () => {
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
  // The label is the one G·2 draws on the recovery card: "Not saved". It is
  // the state said in the reader's words rather than in the system's — and it
  // is still a status, never a cancel action wearing a status's clothes.
  assert.match(source, /session\.recoveryState \? \(\s*<>[\s\S]{0,320}?<span className="marking-session-recovery">Not saved<\/span>/,
    "an ambiguous or committed-pending session must expose recovery as status, not a false cancel action");
  // Recovery states the reason AND the consequence, says whether it was local,
  // and keeps the reader's own words reachable. A failure that loses what the
  // reader wrote is a second failure.
  assert.match(source, /state="failed"\s*thing=\{session\.recoveryState === "committed-pending"[\s\S]*reason=\{session\.recoveryState === "committed-pending"[\s\S]*locality="local"/);
  assert.match(source, /\{draft\.trim\(\) && <q className="marking-connect-kept-text">\{draft\}<\/q>\}/);
  assert.doesNotMatch(source, /disabled=\{busy \|\| Boolean\(session\.recoveryState\)\}/,
    "recovery status must not be rendered as a disabled action");
  assert.match(escape, /if \(session\?\.recoveryState\)[\s\S]*Recovery required[\s\S]*return;[\s\S]*if \(session\)/,
    "Escape must retain exact Retry before ordinary session cancellation");
  assert.match(read("src", "renderer", "components", "ScripturePage.tsx"), /setConnectionExtension\(\{[\s\S]*contextKey: currentMarkingContextKeyRef\.current/);
  assert.match(source, /busy[\s\S]*\? "Saving connection…"[\s\S]*: session\.feedback/);
  assert.match(source, /className="marking-session marking-connect-draft"[\s\S]{0,180}aria-busy=\{busy\}/);
  assert.ok(escape.indexOf("if (busy || activeOperation.current != null)") < escape.indexOf("if (session)"));
  assert.match(escape, /if \(busy \|\| activeOperation\.current != null\) \{[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*return;/);
  assert.match(source, /const activeSelectionNonce = selection\?\.nonce \?\? null/);
  // Each surface gates its own keyboard entry on the thing that actually
  // settles: the palette on its measured placement, the dock on a mode group
  // that is already mounted and not busy. Neither may grab focus from a
  // pointer or screen-reader user.
  assert.match(
    source,
    /if \(activeSelectionNonce == null \|\| persistentSurface \|\| tool\) return;\s*if \(surface === "palette" && palettePlacement\?\.nonce !== activeSelectionNonce\) return;/,
    "palette intent focus must wait for its measured placement commit",
  );
  assert.match(source, /\}, \[activeSelectionNonce, palettePlacement\?\.nonce, persistentSurface, surface, tool\]\);/);
  assert.match(
    source,
    /if \(surface !== "dock" \|\| activeSelectionNonce == null\) return;\s*if \(lastDockAutofocusedSelectionRef\.current === activeSelectionNonce\) return;[\s\S]*?if \(lastInputModality\(\) !== "keyboard"\) return;/,
    "dock intent focus must move once per selection, and only for a keyboard reader",
  );
  assert.equal(
    [...source.matchAll(/lastInputModality\(\) [!=]== "keyboard"/g)].length,
    2,
    "both surfaces consult the same input-modality gate before moving focus, and nothing else does",
  );
  assert.match(source, /const chooseWash[\s\S]*if \(!selection\) \{[\s\S]*onRequestReadingFocus\(\);[\s\S]*setConsumingSelectionNonce\(nonce\);[\s\S]*applyTool\(next, selection\)/);
  assert.match(source, /const chooseConnection[\s\S]*if \(!selection\) \{[\s\S]*onRequestReadingFocus\(\);[\s\S]*setConsumingSelectionNonce\(nonce\);[\s\S]*applyTool\(next, selection\)/);
  // Putting a tool down is the explicit return to reading. The bar is modal on
  // a selection, so closing it IS putting the tool down — one exit, not a
  // separate control that has to be discovered beside the one that is there.
  assert.match(source, /const putDownTool = \(requestReadingFocus = true\): void => \{[\s\S]*?if \(requestReadingFocus\) onRequestReadingFocus\(\)/);
  assert.match(source, /const dismissPalette = \(\): void => \{[\s\S]*if \(!session\) putDownTool\(false\);\s*onDismissSelection\(\);/,
    "the palette's one exit puts down the tool and releases the words together");
  assert.equal([...source.matchAll(/>Cancel draft<\/button>/g)].length, 1,
    "a draft has exactly one explicit way out that is not the exit guard");
});

/**
 * G·2·6 — the paint. A mark is two things and always both: a wash that makes
 * it findable and a 2px rule at double chroma that makes it survive being
 * printed, screenshotted, and seen by a reader who cannot separate the hues.
 * The rule is the accommodation, so it is not optional, and the overlap has a
 * different answer for each half: washes do not multiply, rules stack.
 */
test("a mark is a wash and a rule, and an overlap resolves as geometry rather than as blending", () => {
  const recency = new Map([["older", 0], ["newer", 1], ["newest", 2]]);
  const seg = (id: string, color: string, charStart: number | null, charEnd: number | null) => ({
    id, color, verse: 13, charStart, charEnd,
  });

  // The study's own case: a green mark laid over part of a yellow one.
  const overlap = elementaryIntervals(
    [seg("older", "yellow", null, null), seg("newer", "green", 20, 40)],
    60,
    recency,
  );
  assert.deepEqual(
    overlap.map((interval) => [interval.start, interval.end, interval.marks.map((mark) => mark.hue)]),
    [[0, 20, ["yellow"]], [20, 40, ["green", "yellow"]], [40, 60, ["yellow"]]],
    "the covering set is constant across each stretch, and the newest mark reads first",
  );

  // WASHES DO NOT MULTIPLY. The overlap is painted once, in the newer hue —
  // the older wash is absent there rather than showing through it.
  assert.deepEqual(
    runsAtDepth(overlap, 0).map((run) => [run.start, run.end, run.hue]),
    [[0, 20, "yellow"], [20, 40, "green"], [40, 60, "yellow"]],
    "the newer wash wins the overlap outright; nothing is composited over anything",
  );

  // RULES STACK. The second row exists only under the overlap, which is what
  // makes a 4px stack mean "two marks are present".
  assert.deepEqual(
    runsAtDepth(overlap, 1).map((run) => [run.start, run.end, run.hue]),
    [[20, 40, "yellow"]],
  );
  assert.equal(MAX_STACK * RULE, RULE_CAP, "two rules of 2px, and the stack caps at 4px");
  assert.equal(RULE_CAP, 4);

  // Beyond two the stack does not grow: the third mark is counted, not drawn.
  const crowded = elementaryIntervals(
    [seg("older", "yellow", null, null), seg("newer", "green", 20, 40), seg("newest", "blue", 25, 30)],
    60,
    recency,
  );
  const three = crowded.find((interval) => interval.start === 25 && interval.end === 30);
  assert.ok(three, "the third mark cuts its own stretch");
  assert.deepEqual(three.marks.map((mark) => mark.hue), ["blue", "green", "yellow"]);
  assert.ok(three.marks.length > MAX_STACK, "three marks on one phrase is a filing problem, not a display problem");

  // Same hue, no overlap, touching: one run of paint. Two rectangles meeting
  // at a seam is a hairline the reader can see, and it belongs to no mark.
  const neighbours = elementaryIntervals(
    [seg("older", "yellow", null, 20), seg("newer", "yellow", 20, null)],
    60,
    recency,
  );
  assert.deepEqual(
    runsAtDepth(neighbours, 0).map((run) => [run.start, run.end, run.hue]),
    [[0, 60, "yellow"]],
    "adjacent same-hue marks merge into one measured run, so they never meet at a seam",
  );
});

test("the underlay paints flat ink with no blend mode, and states a count in the gutter beyond two", () => {
  const source = read("src", "renderer", "components", "HighlightUnderlay.tsx");
  const css = read("src", "renderer", "styles", "marking-actions.css");

  // Multiply is exactly the "two translucent layers make a third colour" the
  // study forbids, and a gradient would make one end of a mark louder than the
  // other when all five hues are meant to hold the same lightness and chroma.
  for (const banned of [/mix-blend-mode/, /linear-gradient|radial-gradient/, /hl-grad-/]) {
    assert.doesNotMatch(withoutComments(source), banned, "the paint is flat ink, laid once");
    assert.doesNotMatch(withoutComments(css), banned, "the paint is flat ink, laid once");
  }

  // Each hue publishes both halves of the mark, and the rule reads from the
  // double-chroma token rather than from the wash.
  for (const hue of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.ok(
      css.includes(`.quire-hl-wash[data-hl="${hue}"] { fill: var(--quire-hl-${hue}-wash); }`),
      `${hue} must publish its wash`,
    );
    assert.ok(
      css.includes(`.quire-hl-rule[data-hl="${hue}"] { fill: var(--quire-hl-${hue}-line); }`),
      `${hue}'s rule is the colour-blindness accommodation and is not optional`,
    );
  }

  // The stack is drawn depth by depth and stops at the cap; the count is what
  // happens past it, and it lands in the reserved gutter as a mark, not a fill.
  assert.match(source, /for \(let depth = -1; depth < MAX_STACK; depth\+\+\)/,
    "the rule stack is bounded by the cap, not by the number of marks");
  assert.match(source, /if \(interval\.marks\.length <= MAX_STACK\) continue;/);
  assert.match(source, /className="quire-hl-count"/);
  assert.match(source, /span\.getBoundingClientRect\(\)\.left - cRect\.left - COUNT_INSET/,
    "the gutter lane is measured off the text, so the count holds at both gutter widths");

  // One bar, two target sizes. The dock is the touch case, so G1's 44px row
  // and 28px swatch apply there and the contents stay identical.
  assert.match(css, /\.marking-dock \.marking-bar-swatch \{\s*width: 35px;\s*height: 44px;\s*\}/);
  assert.match(css, /\.marking-dock \.marking-bar-swatch \.marking-pigment \{[^}]*width: 28px;[^}]*border-radius: 6px;/);
  assert.match(css, /\.marking-dock \.marking-bar-action \{ height: 44px; \}/);

  // Motion budget: 180ms to arrive, 120ms to leave, and nothing moves.
  assert.match(css, /@keyframes quire-hl-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
  assert.match(css, /animation: quire-hl-in 180ms linear;/);
  assert.match(css, /animation: quire-hl-out 120ms linear forwards;/);
  assert.doesNotMatch(css, /\.quire-hl-[a-z]+[^{]*\{[^}]*transform:/,
    "a mark arrives by ink alone; nothing about it moves");
});

/**
 * The five rules, held where they can be checked rather than remembered: one
 * loading device, never an illustration, name the thing and the reason, never
 * lose the reader's text, say whether it was local.
 */
test("every state in these surfaces uses the one loading device and names what happened", () => {
  const marking = read("src", "renderer", "components", "MarkingSurface.tsx");
  const capture = read("src", "renderer", "components", "NoteCapture.tsx");
  const css = read("src", "renderer", "styles", "marking-actions.css");

  // ONE loading device. Both authored surfaces use the shared component, and
  // neither invents a second one.
  assert.match(marking, /export function SealProgress/);
  assert.match(capture, /import \{ SealProgress, SurfaceState \} from "\.\/MarkingSurface\.js";/);
  assert.equal([...marking.matchAll(/<SealProgress /g)].length, 2,
    "the shared state component and the draft's head hairline, and nothing else");
  assert.equal([...marking.matchAll(/role="progressbar"/g)].length, 1,
    "one component declares progress for every surface that waits");
  assert.equal([...capture.matchAll(/<SealProgress /g)].length, 1,
    "note capture's save is the surface's only loading device");
  for (const source of [marking, capture]) {
    assert.doesNotMatch(withoutComments(source), /skeleton|<Spinner|spinner-/i);
  }
  // The shared Button's rotating glyph is a spinner, so it does not draw on a
  // surface this study governs. The suppression is scoped and says so.
  assert.match(css, /\.note-capture-save \.control-button-spinner \{ display: none; \}/);

  // NAME THE THING AND THE REASON, and never apologise instead.
  for (const source of [marking, capture]) {
    assert.doesNotMatch(withoutComments(source), /Something went wrong|Oops|An error occurred/i,
      "an apology is not a state");
  }
  assert.match(capture, /thing="This note was not saved\."/);
  assert.match(capture, /reason=\{saveFailure\}/);
  assert.match(capture, /"The library refused the write and did not say why\."/,
    "even the fallback names which surface refused");

  // NEVER LOSE THE READER'S TEXT: a failed write keeps the words on the
  // surface AND offers a way to carry them off it.
  assert.match(capture, /const copyDraft = useCallback/);
  assert.match(capture, /\{copied \? "Copied" : "Copy text"\}/);
  assert.match(capture, /`\$\{buildMarkdown\(\)\}\\n— \$\{draft\.passageRef\}\\n`/,
    "copied words leave with their reference, always");

  // SAY WHETHER IT WAS LOCAL, and let "offline" distinguish what still works.
  assert.match(marking, /locality === "local" \? "On this device\." : "This needed the network\."/);
  assert.match(marking, /Reading and the marks you already made are local and unaffected\./);

  // READ-ONLY is stated before you act, in the reader's terms.
  assert.equal([...marking.matchAll(/reason="Marking is disabled\. Reading is not\."/g)].length, 2,
    "both surfaces state the same consequence of a read-only library");

  // TRUNCATION CLIPS QUOTATION ONLY. Every caller passes a quotation; a
  // reference, date, count or identifier may never be routed through it.
  const clipped = [...marking.matchAll(/clipQuotation\(([^,]+),/g)]
    .map(([, argument]) => argument.trim())
    .filter((argument) => argument !== "quotation: string"); // the declaration itself
  assert.deepEqual(clipped.sort(), ["selection.quote"],
    "only quotations are clipped — a truncated reference is a lie");
  // The reference is structurally out of the clipping element's reach in both
  // places one is shown, rather than merely short enough today.
  assert.match(marking, /<b className="marking-selection-ref">\{selection\.rangeLabel\}<\/b>/);
  assert.match(marking, /<b className="marking-connect-ref">\{reference\}<\/b>/);
  const css2 = read("src", "renderer", "styles", "marking-actions.css");
  assert.match(css2, /\.marking-selection-ref,\s*\.marking-connect-ref \{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(css2, /\.marking-(?:selection|connect)-ref[^{]*\{[^}]*text-overflow/);
  assert.match(marking, /export function clipQuotation\(quotation: string/,
    "the parameter is named for the one thing it may accept");
});

/* ------------------------------------------------------------------------ *
 * Rev 04 §5 — the connection language, rebuilt. D·2 and D·2b are withdrawn
 * in their entirety (§8); nothing below reasons from either.
 * ------------------------------------------------------------------------ */

test("a phrase in three connections carries one underline, not three", () => {
  // "Underlines never stack. A phrase in three connections has ONE underline;
  // the count lives in the gutter tick stack — three ticks, then +n."
  const member = (id: string, left: number, right: number, centerY = 40) => ({
    connection: { id },
    underlines: [{
      path: "",
      anchorIndex: 0,
      lineIndex: 0,
      centerY,
      left,
      right,
    }],
  });

  // Three connections over exactly the same phrase.
  const identical = mergeUnderlineLayer(
    [member("a", 10, 90), member("b", 10, 90), member("c", 10, 90)],
    null,
  );
  assert.equal(identical.length, 1, "three members over one phrase is one stroke");
  assert.deepEqual(identical[0]!.memberIds, ["a", "b", "c"]);
  assert.equal(identical[0]!.attended, false);
  assert.equal(identical[0]!.centerY, 40, "and it sits on the one centre datum");

  // Attending one of them re-inks that single stroke rather than adding one.
  const attended = mergeUnderlineLayer(
    [member("a", 10, 90), member("b", 10, 90), member("c", 10, 90)],
    "b",
  );
  assert.equal(attended.length, 1);
  assert.equal(attended[0]!.attended, true);

  // Partial overlap cuts at the boundary so each run of ink is stroked once,
  // and only the run the attended connection actually covers goes seal.
  const overlapping = mergeUnderlineLayer([member("a", 10, 50), member("b", 30, 90)], "a");
  assert.deepEqual(
    overlapping.map(({ left, right, attended: seal, memberIds }) => ({ left, right, seal, memberIds })),
    [
      { left: 10, right: 50, seal: true, memberIds: ["a", "b"] },
      { left: 50, right: 90, seal: false, memberIds: ["b"] },
    ],
    "runs abut on the datum; nothing is offset and nothing is drawn twice",
  );
  for (let index = 0; index < overlapping.length - 1; index += 1) {
    assert.equal(overlapping[index]!.right, overlapping[index + 1]!.left,
      "a seam is exact, so butt caps read as one continuous rule");
  }

  // A member on another line keeps its own datum.
  const twoLines = mergeUnderlineLayer([member("a", 10, 90, 40), member("b", 10, 90, 68)], null);
  assert.deepEqual(twoLines.map((run) => run.centerY), [40, 68]);

  // Kind ink resolution (2026-07-30 revival): a run resolves exactly one kind
  // — the attended connection's on a seal run, a sole quiet owner's, or none
  // where several quiet owners share — and seams fall wherever that resolved
  // ink changes, so two inks never ride one run.
  const kinds = new Map([["a", "parallel"], ["b", "contrast"]]);
  const hued = mergeUnderlineLayer([member("a", 10, 50), member("b", 30, 90)], "a", kinds);
  assert.deepEqual(
    hued.map(({ left, right, attended: seal, kind }) => ({ left, right, seal, kind })),
    [
      { left: 10, right: 50, seal: true, kind: "parallel" },
      { left: 50, right: 90, seal: false, kind: "contrast" },
    ],
    "the attended stretch carries the attended kind end to end",
  );
  const quietShared = mergeUnderlineLayer([member("a", 10, 50), member("b", 30, 90)], null, kinds);
  assert.deepEqual(
    quietShared.map(({ left, right, kind }) => ({ left, right, kind })),
    [
      { left: 10, right: 30, kind: "parallel" },
      { left: 30, right: 50, kind: null },
      { left: 50, right: 90, kind: "contrast" },
    ],
    "a shared quiet stretch carries no kind, and cuts where the ink changes",
  );
});

test("attending scrolls the least distance that brings every member into view", () => {
  // "All three scroll the least distance that brings every member into view."
  const viewport = { viewportHeight: 600, maxScrollTop: 4000, margin: 24 };

  // Already whole on screen: attending must not move the page under the eye.
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 1000, spanTop: 1100, spanBottom: 1400 }),
    1000,
    "a connection you can already see does not scroll at all",
  );

  // Below the fold: come up by the smallest delta that lands the last member
  // inside, not to a centre and not to an eye-line.
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 1000, spanTop: 1300, spanBottom: 1700 }),
    1124,
    "the bottom member arrives one margin inside the fold, and no further",
  );

  // Above: the same rule in the other direction.
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 1000, spanTop: 900, spanBottom: 1200 }),
    876,
  );

  // Taller than the viewport — no offset shows every member, so show the
  // first and let the reader scroll on.
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 3000, spanTop: 1000, spanBottom: 2400 }),
    976,
  );

  // Never past either end of the scroll range.
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 300, spanTop: 10, spanBottom: 60 }),
    0,
  );
  assert.equal(
    leastScrollForMembers({ ...viewport, scrollTop: 0, spanTop: 9000, spanBottom: 9100, maxScrollTop: 4000 }),
    4000,
  );
});

test("arity is read off the kind, and decides the affordance and the greying", () => {
  // "Arity is not decoration: it decides whether *Add a phrase* is offered at
  // all. The inspector reads it off the kind and greys the exact-2 kinds while
  // a 3-member connection is attended." Both halves, both directions.
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");
  const styles = read("src", "renderer", "styles.css");

  // The affordance: Add a phrase is not offered for an exact-2 kind.
  assert.match(card, /!isBinaryConnectionKind\(connection\.kind\) && \(\s*<button[\s\S]{0,320}>Add phrase<\/button>/);

  // The greying: an exact-2 kind is disabled, and stays visible while it is.
  assert.match(card, /const arityBlocked = isBinaryConnectionKind\(option\.id\)\s*&& connection\.anchors\.length !== 2/);
  assert.match(card, /disabled=\{mutationLocked \|\| arityBlocked\}/);
  assert.match(card, /data-arity-blocked=\{arityBlocked \? "" : undefined\}/);
  assert.match(styles, /\.connection-card-kind-option\[data-arity-blocked\] \{[\s\S]{0,160}opacity: \.38;/);
  assert.doesNotMatch(card, /arityBlocked \?\?? null|!arityBlocked && <button/,
    "a blocked kind is greyed, not removed: the reader must see that it exists");

  // A blocked kind cannot be committed even if the control is reached anyway,
  // because the durable validator would reject it at the boundary.
  assert.match(card, /if \(isBinaryConnectionKind\(kind\) && connection\.anchors\.length !== 2\) return;/);

  // The six kinds are words, in the UI sans, and never a colour or a glyph.
  assert.match(card, /RELATIONSHIPS\.map\(\(option\)/);
  assert.match(styles, /\.connection-card-kind-option \{[\s\S]{0,320}font: 500 [\d.]+rem\/[\d.]+ var\(--font-ui\)/);
});

test("the kind is the only word a route carries, and it sits on the engine's spine", () => {
  // "The kind is the only word a route carries — one word in seal small caps
  // at the spine's head."
  const source = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const styles = read("src", "renderer", "styles.css");

  assert.match(source, /className="connection-route-kind"/);
  assert.match(source, />\{relationshipLabel\(item\.connection\.kind\)\}<\/text>/,
    "the label comes off the one shared vocabulary table, unabbreviated");
  // The coordinate is read off the plan, never recomputed: the engine owns
  // "where the spine sits in real gutter air".
  assert.match(source, /spineHead: plan\.spine\s*\? \{ x: plan\.spine\.x, y: plan\.spine\.top - SPINE_KIND_GAP \}/);
  assert.match(styles, /\.connection-route-kind \{[\s\S]{0,400}font-variant-caps: all-small-caps;/);
  // REVISED 2026-07-30 by the connections revival: the word keeps its place at
  // the spine's head (Rev 04's good addition), but rides the mark's kind ink
  // (currentColor) rather than seal, so the route and its name are one colour
  // — never gold-on-teal.
  assert.match(styles, /\.connection-route-kind \{[\s\S]{0,400}fill: currentColor/);
  assert.match(styles, /\.connection-route-kind \{[\s\S]{0,400}font-family: var\(--font-ui\)/);
});

test("the wash ladder is the Era-3 atmosphere, and it quiets itself when awake", () => {
  // REWRITTEN 2026-07-30 by the connections revival — a dated reversal of
  // Rev 04's Law 5 ("a relation may not wash"), which this test used to hold.
  // The reader ruled the Era-3 C0.5 paint (64d0e5f) the canon, and its wash
  // ladder returns exactly: dormant .09 in the kind's ink (.045 glyph
  // overprint in the dark), a held companion at .05, the woken preview at
  // .12, the selected phrase at .16, shared words under one gold band at .14.
  // Law 5's real concern survives as the ladder's own discipline: while
  // anything is attended, the dormant field and the gold band recede to 0
  // (`is-awake`), so the page quiets itself around the one chosen thing.
  const styles = read("src", "renderer", "styles.css");
  assert.match(styles, /\.connection-emphasis-wash \{[\s\S]{0,200}fill-opacity: \.09;/,
    "dormant presence is the rule's own default: .09 of the kind's ink");
  assert.match(styles, /\.dark \.connection-emphasis-mark\[data-paint-state="dormant"\] \.connection-emphasis-wash \{\s*fill-opacity: \.045;/,
    "the dark atmospheres overprint glyphs instead of laying fields");
  assert.match(styles, /\.connection-emphasis-underlay\.is-awake\s*\.connection-emphasis-mark\[data-paint-state="dormant"\]\s*\.connection-emphasis-wash \{ fill-opacity: 0; \}/,
    "while one connection is attended, the dormant field recedes to nothing");
  assert.match(styles, /\[data-paint-state="companion"\] \.connection-emphasis-wash \{ fill-opacity: \.05; \}/);
  assert.match(styles, /\[data-paint-state="preview"\] \.connection-emphasis-wash \{ fill-opacity: \.12; \}/);
  assert.match(styles, /\[data-paint-state="selected"\] \.connection-emphasis-wash,\s*\.connection-emphasis-mark\[data-paint-state="needs-space"\] \.connection-emphasis-wash \{ fill-opacity: \.16; \}/);
  assert.match(styles, /\.connection-emphasis-shared \{[\s\S]{0,160}fill: var\(--study-gold\);\s*fill-opacity: \.14;/,
    "words two connections claim carry one gold band");
  assert.match(styles, /\.connection-emphasis-underlay\.is-awake \.connection-emphasis-shared \{ fill-opacity: 0; \}/);

  // What says "connected to THAT text" is still a rule on the fixed datum —
  // quiet in its kind's ink (faint where quiet owners share), seal-weight in
  // the attended kind's ink.
  assert.match(styles, /\.connection-underline \{[\s\S]{0,700}stroke: var\(--connection-ink, var\(--ink-faint, #C8C2B8\)\)/);
  assert.match(styles, /\.connection-underline\.attended \{[\s\S]{0,200}stroke: var\(--connection-ink, var\(--study-gold\)\)/);
});
