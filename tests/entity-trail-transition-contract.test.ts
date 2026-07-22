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
    "const currentResearchIsRecorded",
  );

  assert.match(trailHandlers, /void onOpenEntity\(target\.id, \{ trailIndex: index \}\);/);
  assert.match(trailHandlers, /void onOpenEntity\(previous\.id, \{ trailIndex: previousIndex \}\);/);
  assert.doesNotMatch(trailHandlers, /onEntityTrailChange/);
  assert.doesNotMatch(trailHandlers, /\.focus\(|setEntityResearch|setActiveTab/);
});

test("ScripturePage preserves the async trail-navigation result", () => {
  const wrapper = section(
    scripture,
    "const handleOpenMarginEntity",
    "const handleNoteCaptureSaved",
  );

  assert.match(wrapper, /options\?: EntityResearchOpenOptions/);
  assert.match(wrapper, /\): Promise<boolean> => \{/);
  assert.match(wrapper, /if \(!onOpenEntity\) return Promise\.resolve\(false\);/);
  assert.match(wrapper, /return onOpenEntity\([\s\S]*marginWorkspace === "research" \? "navigate" : "tab", options\);/);
  assert.doesNotMatch(wrapper, /onOpenEntity\?\./);
});

test("App applies an approved trail target and entity change in one commit", () => {
  const intent = section(
    app,
    "const openEntityResearchAt",
    "const openEntityResearch =",
  );
  const transition = intent.indexOf('runWorkspaceTransition("tab-change"');
  const commit = intent.indexOf("commitStudyWorkspace(");
  const validateTarget = intent.indexOf(".id !== entityId");
  const truncate = intent.indexOf("truncateEntityResearchTrail(");
  const navigate = intent.indexOf("navigateEntityWorkspaceTab(");

  assert.ok(transition >= 0 && commit > transition);
  assert.ok(validateTarget > commit && truncate > validateTarget && navigate > truncate);
  assert.equal(intent.match(/commitStudyWorkspace\(/g)?.length, 1);
  assert.equal(intent.match(/navigateEntityWorkspaceTab\(/g)?.length, 1);
  assert.doesNotMatch(intent.slice(0, transition), /trailIndex|truncateEntityResearchTrail/);
});
