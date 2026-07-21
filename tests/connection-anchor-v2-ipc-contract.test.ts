import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

test("Electron owns exact capture and package projection behind a closed bridge", () => {
  const main = read("src", "electron", "main.ts");
  const preload = read("src", "electron", "preload.ts");
  const api = read("src", "renderer", "api.ts");

  assert.match(main, /new OccurrenceAlignmentStore\(\{[\s\S]*scriptureRoot: DATA_DIR,[\s\S]*packageId: "bsb"/);
  assert.match(main, /new LibraryEngine\([\s\S]*nextOccurrenceAlignmentStore/);
  assert.match(main, /occurrenceAlignmentStore: nextOccurrenceAlignmentStore/);
  assert.match(main, /runtime\.occurrenceAlignmentStore\.close\(\)/);
  assert.match(main, /nextOccurrenceAlignmentStore\.close\(\)/);

  assert.match(main, /registerRuntimeReadIpc\("capture-connection-selection"/);
  assert.match(main, /normalizeOccurrenceSelections\(rawRequest\["selections"\]\)/);
  assert.match(main, /occurrenceEvidence\([\s\S]*captureOccurrenceAlignedSelection\(/);
  assert.match(main, /registerRuntimeReadIpc\("project-connections"/);
  assert.match(main, /engine\.queryAuthoredConnectionHeads\(/);
  assert.match(main, /connection\.activeEventId !== request\.expectedActiveEventId/);
  assert.match(main, /code: "authored-projection-refused"/);
  assert.match(main, /code: "runtime-unavailable"/);
  assert.match(main, /projectBackboneTokenAnchor\(/);
  assert.match(main, /status: "unavailable",[\s\S]*anchors: \[\]/);

  assert.match(preload, /captureConnectionSelection:[\s\S]*ipcRenderer\.invoke\("capture-connection-selection"/);
  assert.match(preload, /projectConnections:[\s\S]*ipcRenderer\.invoke\("project-connections"/);
  assert.match(api, /captureConnectionSelection\([\s\S]*Promise<CaptureOccurrenceSelectionResult>/);
  assert.match(api, /projectConnections\([\s\S]*Promise<ConnectionPaintProjectionResponse>/);
});

test("projection never quote-searches, widens, or leaks render evidence into v2", () => {
  const main = read("src", "electron", "main.ts");
  const underlay = read("src", "renderer", "components", "ConnectionUnderlay.tsx");
  const marking = read("src", "renderer", "components", "MarkingSurface.tsx");
  const paint = read("src", "renderer", "utils", "connectionPaint.ts");
  const mainProjection = main.slice(
    main.indexOf("function projectLegacyConnection"),
    main.indexOf("function getScriptureSearchCorpus"),
  );
  const rangeProjection = underlay.slice(
    underlay.indexOf("function rangeRectsForAnchor"),
    underlay.indexOf("export function ConnectionUnderlay"),
  );

  assert.doesNotMatch(mainProjection, /\.indexOf\(/);
  assert.doesNotMatch(rangeProjection, /\.indexOf\(/);
  assert.doesNotMatch(rangeProjection, /selectNodeContents/);
  assert.match(mainProjection, /text\.slice\(locator\.char_start, locator\.char_end\) !== locator\.quote/);
  assert.match(mainProjection, /return unavailableConnectionProjection\(/);
  assert.match(rangeProjection, /text\.slice\(paintFragment\.char_start, paintFragment\.char_end\) === paintFragment\.quote/);
  assert.match(rangeProjection, /if \(!packageExact\) continue/);

  assert.match(paint, /renderer DTO[\s\S]*must never[\s\S]*cross the mutation broker/);
  assert.doesNotMatch(paint, /format_version|render_locator|baseEventId|deviceId|\bseq\b/);
  assert.match(paint, /sourceActiveEventId: string \| null/);
  assert.match(paint, /expectedActiveEventId: string/);
  assert.match(marking, /anchors: ConnectionAnchorV2\[\]/);
  assert.match(marking, /paintAnchors: ConnectionPaintAnchor\[\]/);
  assert.match(marking, /current\.capture\.status === "pending"/);
  assert.match(marking, /current\.capture\.status === "refused"/);
  assert.match(marking, /anchors: \[\.\.\.base\.anchors, current\.capture\.anchor\]/);
});

test("renderer invalidates stale capture and projection responses before paint", () => {
  const page = read("src", "renderer", "components", "ScripturePage.tsx");
  const underlay = read("src", "renderer", "components", "ConnectionUnderlay.tsx");

  assert.match(page, /selectionGenerationRef\.current !== nonce/);
  assert.match(page, /currentMarkingContextKeyRef\.current !== contextKey/);
  assert.match(page, /const request = \+\+connectionPaintRequestRef\.current/);
  assert.match(page, /request !== connectionPaintRequestRef\.current/);
  assert.match(page, /connectionPaintState\?\.requestKey === connectionPaintRequestKey[\s\S]*EMPTY_CONNECTION_PAINT_PROJECTIONS/);
  assert.match(page, /result\.value\.packageId !== packageId/);
  assert.match(page, /projection\.sourceActiveEventId !== expectedVersion/);
  assert.match(page, /projection\.status !== "unavailable" && projection\.sourceActiveEventId !== expectedVersion/);
  assert.match(page, /marginDataChapterKey === `\$\{book\}:\$\{chapter\}`[\s\S]*EMPTY_MARGIN_DATA/);
  assert.match(page, /paintProjections=\{currentConnectionPaintProjections\}/);
  assert.match(underlay, /projection\.status === "unavailable" \|\| projection\.anchors\.length === 0/);
  assert.match(underlay, /const focused = selectedConnectionId === connection\.id/);
  assert.match(underlay, /if \(!focused\)[\s\S]*routePath: ""[\s\S]*contacts: \[\]/);
});

test("v2 observation and causal timestamps remain explicit authored fields", () => {
  const preload = read("src", "electron", "preload.ts");
  const main = read("src", "electron", "main.ts");
  const card = read("src", "renderer", "components", "ConnectionCard.tsx");
  const reconciliation = read("src", "renderer", "utils", "connectionMutationReconciliation.ts");

  assert.match(preload, /createConnection: \(kind: ConnectionKind, label: string, observation: string, anchors: ConnectionAnchorV2\[\]/);
  assert.match(preload, /input: \{ kind, label, observation, anchors \}/);
  assert.match(main, /observation: rawCommand\["observation"\]/);
  assert.match(card, /value=\{draftObservation\}/);
  assert.match(card, /onBlur=\{\(\) => \{[\s\S]*saveObservation\(\)/);
  assert.match(card, /connection\.format_version !== 2[\s\S]*exact-anchor replacement before editing/);
  assert.match(card, /dateTime=\{connection\.updatedAt\}/);
  assert.match(reconciliation, /connection\.format_version === 2 \? connection\.observation : null/);
});
