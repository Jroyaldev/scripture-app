import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const margin = read("src/renderer/components/LivingMargin.tsx");
const scripture = read("src/renderer/components/ScripturePage.tsx");
const app = read("src/renderer/app.tsx");

function section(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test("trail and Back requests do not mutate trail or focus before async approval", () => {
  const trailHandlers = section(
    margin,
    "const openTrailEntity",
    "const researchLayerRef",
  );

  assert.match(trailHandlers, /void onDrillEntity\(\{[\s\S]*?id: target\.id,[\s\S]*?displayName: target\.displayName,[\s\S]*?kind: target\.kind \?\? "other",[\s\S]*?\}, \{ trailIndex: index \}\);/);
  assert.match(trailHandlers, /const previous: EntityResearchTarget = \{[\s\S]*?id: previousEntity\.id,[\s\S]*?displayName: previousEntity\.displayName,[\s\S]*?kind: previousEntity\.kind \?\? "other",[\s\S]*?\};/);
  assert.match(trailHandlers, /void onDrillEntity\(previous, \{ trailIndex: previousIndex \}\);/);
  assert.doesNotMatch(trailHandlers, /onEntityTrailChange/);
  assert.doesNotMatch(trailHandlers, /\.focus\(|setEntityResearch|setActiveTab/);
});

test("ScripturePage keeps Study opens and Research drills on distinct async callbacks", () => {
  const wrapper = section(
    scripture,
    "const handleOpenMarginEntity",
    "const handleNoteCaptureSaved",
  );
  const marginWiring = section(
    scripture,
    "<LivingMargin",
    "authoredConnections=",
  );

  assert.match(wrapper, /target: EntityResearchTarget/);
  assert.match(wrapper, /\): Promise<boolean> => \{/);
  assert.match(wrapper, /if \(!onOpenEntity\) return Promise\.resolve\(false\);/);
  assert.match(wrapper, /return onOpenEntity\(target\);/);
  assert.doesNotMatch(wrapper, /onOpenEntity\?\./);
  assert.match(marginWiring, /onOpenEntity=\{handleOpenMarginEntity\}/);
  assert.match(marginWiring, /onDrillEntity=\{onDrillEntity\}/);
  assert.doesNotMatch(marginWiring, /onDrillEntity=\{handleOpenMarginEntity\}/);
});

test("App applies an approved trail target and entity change in one commit", () => {
  const intent = section(
    app,
    "const openEntityResearchAt",
    "const openEntityResearch = useCallback",
  );
  const transition = intent.indexOf('runWorkspaceTransition("tab-change"');
  const commit = intent.indexOf("commitStudyWorkspace(");
  const validateTarget = intent.indexOf("existingTarget.id !== target.id");
  const truncate = intent.indexOf("truncateEntityResearchTrail(");
  const navigate = intent.indexOf("navigateEntityWorkspaceTab(");
  const approvedFocus = intent.indexOf("if (requestFocus");

  assert.ok(transition >= 0 && commit > transition);
  assert.ok(validateTarget > commit && truncate > validateTarget && navigate > truncate);
  assert.ok(approvedFocus > navigate);
  assert.match(intent.slice(approvedFocus), /proceed[\s\S]*openedOwnerTabId !== null[\s\S]*activeTabId === openedOwnerTabId/);
  assert.equal(intent.match(/commitStudyWorkspace\(/g)?.length, 1);
  assert.equal(intent.match(/navigateEntityWorkspaceTab\(/g)?.length, 1);
  assert.doesNotMatch(intent.slice(0, transition), /trailIndex|truncateEntityResearchTrail/);
});
