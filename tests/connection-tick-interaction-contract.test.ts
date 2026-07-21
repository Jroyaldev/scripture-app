import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf-8");
const underlay = read("src/renderer/components/ConnectionUnderlay.tsx");
const page = read("src/renderer/components/ScripturePage.tsx");
const popover = read("src/renderer/components/Popover.tsx");
const app = read("src/renderer/app.tsx");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  assert.ok(end > start, `source markers are out of order: ${startMarker}`);
  return source.slice(start, end);
}

test("an aggregate tick reports chooser state rather than selected-member state", () => {
  assert.match(page, /aggregateMemberIds: connections\.map\(\(connection\) => connection\.id\)/);
  assert.match(page, /openTickGroupMemberIds=\{connectionWordChooser\?\.aggregateMemberIds \?\? null\}/);
  assert.match(page, /<Popover\s+id="connection-word-chooser"/);
  assert.match(popover, /id=\{id\}[\s\S]{0,80}ref=\{panelRef\}/);

  const tick = sourceBetween(underlay, "const aggregateExpanded = aggregate", "onPointerEnter={() => {");
  assert.match(tick, /openTickGroupMemberIds\.length === lane\.memberIds\.length/);
  assert.match(tick, /lane\.memberIds\.every\(\(connectionId\) => openTickGroupMemberIds\.includes\(connectionId\)\)/);
  assert.match(tick, /aria-expanded=\{aggregate \? aggregateExpanded : selected\}/);
  assert.match(tick, /aggregateExpanded \? "connection-word-chooser" : undefined/);
});

test("tick activation only opens or reaffirms; the labelled card action owns Release", () => {
  const activation = sourceBetween(
    underlay,
    "onClick={(event) => {",
    "            >\n              <span className=\"connection-tick-dash\" aria-hidden=\"true\" />",
  );
  assert.match(activation, /onSelectConnection\(item\.connection\.durableRecord, event\.detail === 0\)/);
  assert.match(activation, /remains selected\. Connection details are open in Study/);
  assert.doesNotMatch(activation, /onSelectConnection\(selected \? null/);
  assert.match(underlay, /data-held-connection-ids=\{userHeld \? encodeConnectionTickMemberIds\(heldMemberIds\) : undefined\}/);
  assert.match(read("src/renderer/components/ConnectionCard.tsx"), />Release<\/button>/);
});

test("Focus mode yields Escape while the connection card owns its local ladder", () => {
  // The shared layer registry decides Escape ownership everywhere; the app
  // exits Focus mode only when no layer is registered.
  assert.match(app, /layerStackIsEmpty\(\)/);
  assert.match(read("src/renderer/components/ConnectionCard.tsx"), /isTopLayer\(layerRef\.current\)/);
});
