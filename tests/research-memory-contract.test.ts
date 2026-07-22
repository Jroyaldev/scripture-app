import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  appendEntityResearchTrail,
  ENTITY_RESEARCH_TRAIL_LIMIT,
  truncateEntityResearchTrail,
  type EntityResearchTrailEntry,
} from "../src/renderer/components/LivingMargin.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const app = read("src/renderer/app.tsx");
const margin = read("src/renderer/components/LivingMargin.tsx");
const main = read("src/electron/main.ts");
const css = read("src/renderer/styles.css");

function entry(index: number, displayName = `Entity ${index}`): EntityResearchTrailEntry {
  return { id: `entity-${index}`, displayName };
}

test("research trail preserves causal order, truncates returns, and caps at 12", () => {
  let trail: EntityResearchTrailEntry[] = [];
  for (let index = 1; index <= ENTITY_RESEARCH_TRAIL_LIMIT + 3; index += 1) {
    trail = appendEntityResearchTrail(trail, entry(index));
  }
  assert.equal(trail.length, ENTITY_RESEARCH_TRAIL_LIMIT);
  assert.equal(trail[0]?.id, "entity-4");
  assert.equal(truncateEntityResearchTrail(trail, 4).at(-1)?.id, "entity-8");
  const renamed = appendEntityResearchTrail(trail, entry(15, "Renamed"));
  assert.equal(renamed.length, trail.length);
  assert.equal(renamed.at(-1)?.displayName, "Renamed");
});

test("breadcrumbs render frozen origin, prior return targets, and inert current state", () => {
  assert.match(margin, /<nav className="entity-research-breadcrumbs" aria-label="Research trail">/);
  assert.match(margin, /className="entity-research-breadcrumb is-origin"[\s\S]{0,120}?onClick=\{onCloseEntity\}/);
  assert.match(margin, /onClick=\{\(\) => openTrailEntity\(index\)\}/);
  assert.match(margin, /className="entity-research-breadcrumb is-current" aria-current="page"/);
  assert.match(css, /\.entity-research-breadcrumb-tail\s*\{[\s\S]{0,180}?overflow: hidden;/);
});

test("validated settings persist grouped workspace tabs while legacy session stays migratable", () => {
  assert.match(main, /function normalizeResearchSession/);
  assert.match(main, /trail\.slice\(-12\)/);
  assert.match(main, /function normalizeResearchWorkspace/);
  assert.match(main, /candidate\["tabs"\]\.slice\(0, 64\)/);
  assert.match(main, /researchWorkspace: normalizeResearchWorkspace\([\s\S]{0,120}?partial\.researchWorkspace/);
  assert.match(app, /setResearchWorkspace\(res\.value\.researchWorkspace\)/);
  assert.match(app, /window\.api\.settings\.set\(\{[\s\S]{0,220}?researchWorkspace:/);
  const close = app.slice(app.indexOf("const closeResearchTab"), app.indexOf("const updateEntityResearchTrail"));
  assert.match(close, /closeResearchTabState\(current, tabId\)/);
  assert.doesNotMatch(close, /setResearchWorkspace\(createResearchWorkspaceState/);
});

test("entity kind rides the research trail into tab marks and survives settings normalization", () => {
  const workspaceTabs = read("src/renderer/components/ScriptureWorkspaceTabs.tsx");
  const workspaceUtil = read("src/renderer/utils/researchWorkspace.ts");
  assert.match(margin, /kind: result\.value!\.entity\.kind/);
  assert.match(main, /kind === "person" \|\| kind === "place" \|\| kind === "other"/);
  assert.match(workspaceUtil, /export function researchWorkspaceTabKind/);
  assert.match(workspaceTabs, /<TabMark kind=\{researchWorkspaceTabKind\(tab\)\} \/>/);
  assert.match(workspaceTabs, /function PersonGlyph/);
  assert.match(workspaceTabs, /function PlaceGlyph/);
  assert.match(css, /\.scripture-workspace-tab-mark\.is-person,/);
  assert.match(css, /\.scripture-workspace-tab-mark\.is-place \{/);
});

test("Close exits directly while Back and Escape remain stepwise and named", () => {
  assert.match(margin, /className="entity-research-close"[\s\S]{0,100}?onClick=\{onCloseEntity\}/);
  assert.match(margin, /const previousIndex = entityTrail\.length - \(currentIsRecorded \? 2 : 1\)/);
  assert.match(margin, /truncateEntityResearchTrail\(current, previousIndex\)/);
  assert.match(margin, /aria-label=\{`Back to \$\{researchBackDestination\}`\}/);
  assert.match(margin, /event\.key !== "Escape"[\s\S]{0,340}?openPreviousEntity\(\)/);
});

test("principal research stays compact and deep datasets share one More disclosure", () => {
  const viewStart = margin.indexOf("return (", margin.indexOf("function EntityResearchView"));
  const moreStart = margin.indexOf('<details className="entity-research-more"', viewStart);
  const sourcesStart = margin.indexOf("<MarginSourcesDisclosure", moreStart);
  assert.ok(viewStart >= 0 && moreStart > viewStart && sourcesStart > moreStart);
  const principal = margin.slice(viewStart, moreStart);
  for (const marker of ["entity-research-identity", "EntityOpeningContextSection", "EntityMiniMap", "entity-research-capture"]) {
    assert.ok(principal.includes(marker), `principal view missing ${marker}`);
  }
  for (const marker of ["PersonRelationships", "PleiadesResearchSection", "entity-reference-list"]) {
    assert.ok(!principal.includes(marker), `${marker} escaped More`);
  }
  const deep = margin.slice(moreStart, sourcesStart);
  assert.match(deep, /<summary>More<\/summary>/);
  for (const marker of ["{photo}", "PersonRelationships", "PleiadesResearchSection", "entity-reference-list"]) {
    assert.ok(deep.includes(marker), `More missing ${marker}`);
  }
});
