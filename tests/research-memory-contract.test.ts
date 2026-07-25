import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  appendEntityResearchTrail,
  ENTITY_RESEARCH_TRAIL_LIMIT,
  isExplicitEntityBranchGesture,
  truncateEntityResearchTrail,
  type EntityResearchTrailEntry,
} from "../src/renderer/components/LivingMargin.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const app = read("src/renderer/app.tsx");
const margin = read("src/renderer/components/LivingMargin.tsx");
const main = read("src/electron/main.ts");
const settingsBoundary = read("src/electron/study-workspace-settings.ts");
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
  assert.match(margin, /className="entity-research-breadcrumb is-origin"[\s\S]{0,160}?onClick=\{onReturnEntityOrigin\}/);
  assert.match(margin, /onClick=\{\(\) => openTrailEntity\(index\)\}/);
  assert.match(margin, /className="entity-research-breadcrumb is-current" aria-current="page"/);
  assert.match(css, /\.entity-research-breadcrumb-tail\s*\{[\s\S]{0,180}?overflow: hidden;/);
});

test("validated V2 settings absorb legacy workspace inputs without renderer legacy writes", () => {
  assert.match(main, /function normalizeResearchSession/);
  assert.match(main, /trail\.slice\(-12\)/);
  assert.match(main, /function normalizeResearchWorkspace/);
  assert.match(main, /candidate\["tabs"\]\.slice\(0, 64\)/);
  assert.match(main, /bootstrapStudyWorkspaceSetting/);
  assert.match(settingsBoundary, /export function migrateLegacyStudyWorkspace/);
  assert.match(settingsBoundary, /normalizeLegacyResearchWorkspace\(input\.researchWorkspace\)/);
  assert.doesNotMatch(
    app,
    /window\.api\.settings\.set\(\{\s*(?:researchWorkspace|researchSession|keptContext)\b/,
  );
  const close = app.slice(app.indexOf("const closeResearchTab"), app.indexOf("const updateEntityResearchTrail"));
  assert.match(close, /runWorkspaceTransition\("tab-close"/);
  assert.match(close, /const requested = closeStudyWorkspaceTab\(snapshot, tabId\)/);
  assert.match(close, /requested\.outcome === "needs-confirmation"/);
  assert.match(close, /result = resolveStudyWorkspaceDecision\(latest, requested\.confirmation, decision\)/);
  assert.match(app, /workspacePersistenceRef\.current\.persistStructure\(next\)/);
  assert.doesNotMatch(app, /setResearchWorkspace|createResearchWorkspaceState/);
});

test("entity kind rides the research trail into tab marks and survives settings normalization", () => {
  const workspaceTabs = read("src/renderer/components/ScriptureWorkspaceTabs.tsx");
  const workspaceUtil = read("src/renderer/utils/studyWorkspace.ts");
  assert.match(margin, /kind: result\.value!\.entity\.kind/);
  assert.match(main, /kind === "person" \|\| kind === "place" \|\| kind === "other"/);
  assert.match(workspaceUtil, /export function studyWorkspaceTabType/);
  assert.match(workspaceTabs, /<TabMark tab=\{tab\} \/>/);
  assert.match(workspaceTabs, /function PersonGlyph/);
  assert.match(workspaceTabs, /function PlaceGlyph/);
  assert.match(css, /\.scripture-workspace-tab-mark\.is-person,/);
  assert.match(css, /\.scripture-workspace-tab-mark\.is-place \{/);
});

test("workspace-derived research and kept intents memoize by semantic scalars", () => {
  const entityMemo = app.slice(
    app.indexOf("const entityIntent = useMemo"),
    app.indexOf("const activeScope", app.indexOf("const entityIntent = useMemo")),
  );
  assert.doesNotMatch(entityMemo, /\[activeEntityTab\]/);
  for (const dependency of [
    "activeEntityId",
    "activeEntityNonce",
    "activeEntityOriginBook",
    "activeEntityOriginChapter",
    "activeEntityOriginPackageId",
    "activeEntityOriginVerseStart",
    "activeEntityOriginVerseEnd",
  ]) {
    assert.match(entityMemo, new RegExp(`\\b${dependency}\\b`));
  }

  const keptStart = app.indexOf("const keptContext:");
  const keptMemo = app.slice(
    keptStart,
    app.indexOf("const [workspaceIntent", keptStart),
  );
  assert.match(keptMemo, /\[keptBook, keptChapter, keptVerse, keptEndVerse, keptLabel\]/);
  assert.doesNotMatch(keptMemo, /\[activeScope\]/);
});

test("Close alone deletes while Back, Return, and Escape preserve the research tab", () => {
  assert.match(margin, /className="entity-research-close"[\s\S]{0,100}?onClick=\{onCloseEntity\}/);
  assert.match(margin, /const previousIndex = entityTrail\.length - \(currentResearchIsRecorded \? 2 : 1\)/);
  const backStart = margin.indexOf("const openPreviousEntity");
  const backEnd = margin.indexOf("const researchLayerRef", backStart);
  const back = margin.slice(backStart, backEnd);
  assert.match(back, /void onDrillEntity\(previous, \{ trailIndex: previousIndex \}\)/);
  assert.doesNotMatch(back, /onCloseEntity/);
  assert.match(margin, /className="entity-research-return"[\s\S]{0,160}?onClick=\{onReturnEntityOrigin\}/);
  assert.match(margin, /aria-label=\{`Return to \$\{originLabel\}`\}/);
  assert.match(margin, /event\.key !== "Escape"[\s\S]{0,520}?previousEntity[\s\S]{0,220}?openPreviousEntity\(\)[\s\S]{0,180}?onReturnEntityOrigin\?\.\(\)/);
  assert.doesNotMatch(margin.slice(margin.indexOf('const closeResearch ='), margin.indexOf('window.addEventListener("keydown", closeResearch')), /onCloseEntity/);
});

test("Study opens a named research tab while entity drill and branch remain distinct", () => {
  assert.equal(isExplicitEntityBranchGesture({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false }), false);
  assert.equal(isExplicitEntityBranchGesture({ button: 0, metaKey: true, ctrlKey: false, shiftKey: false }), true);
  assert.equal(isExplicitEntityBranchGesture({ button: 0, metaKey: false, ctrlKey: true, shiftKey: false }), true);
  assert.equal(isExplicitEntityBranchGesture({ button: 0, metaKey: false, ctrlKey: false, shiftKey: true }), true);
  assert.equal(isExplicitEntityBranchGesture({ button: 1, metaKey: false, ctrlKey: false, shiftKey: false }), true);

  assert.match(margin, /export interface EntityResearchTarget \{[\s\S]{0,220}?displayName: string;[\s\S]{0,120}?kind: "person" \| "place" \| "other";/);
  // The name carries the destination as its accessible name; the caption that
  // used to appear on hover is gone with the card.
  //
  // This used to read `openLabel={`Open research tab for ${entity.displayName}`}`,
  // when the overview drew its entities through `MarginEntryNameLine` and the
  // label arrived as a prop. Quire C4·3 sets those four names at 16px serif in
  // a fixed column instead of 28px in an entry, so the overview's name is now a
  // plain button carrying the same sentence as its own `aria-label`. The entry
  // skeleton — and its `openLabel` prop — still serves the research pane, and
  // the assertion below still guards it.
  assert.match(margin, /aria-label=\{`Open research tab for \$\{entity\.displayName\}`\}/);
  assert.match(margin, /<button type="button" className="margin-entry-name-open" onClick=\{onOpen\} aria-label=\{openLabel\}>/);
  assert.match(margin, /onOpenEntity\?\.\(entityResearchTarget\(entity\)\)/);

  const relationshipsStart = margin.indexOf("function PersonRelationships");
  const relationshipsEnd = margin.indexOf("function PleiadesResearchSection", relationshipsStart);
  assert.ok(relationshipsStart >= 0 && relationshipsEnd > relationshipsStart);
  const relationships = margin.slice(relationshipsStart, relationshipsEnd);
  assert.match(relationships, /onDrillEntity\?\.\(target\)/);
  assert.match(relationships, /void onBranchEntity\(target\)/);
  // The aux gesture is still a modifier-click on the name, but the row now
  // renders through the entry skeleton, so it arrives as a named handler.
  assert.match(relationships, /onAuxActivate:/);
  assert.match(relationships, /isExplicitEntityBranchGesture\(event\)/);
  assert.match(relationships, /branchLabel: `Open \$\{relationship\.displayName\} in a new research tab/);
  // Both verbs are named in the markup, never inferred from a modifier key.
  assert.match(margin, /className="margin-entry-verb"[\s\S]{0,200}?Follow/);
  assert.match(margin, /className="margin-entry-verb"[\s\S]{0,200}?Branch/);
});

test("entity references follow the current canvas and expose an explicit passage-tab branch", () => {
  const viewStart = margin.indexOf("function EntityResearchView");
  // This slice used to end at `function CrossReferenceRow`, which Quire C·4
  // deleted along with the Connections tab's cross-reference lists. `indexOf`
  // answered -1, and `slice(start, -1)` is not an error — it silently runs to
  // the end of the file, so "the view" became every line below it and the three
  // assertions could have been satisfied by code in any later component. The
  // test stayed green the whole time. Both ends are asserted found now, so the
  // next deletion fails loudly here instead of quietly widening the scope.
  const viewEnd = margin.indexOf("function connectionMemberPosition", viewStart);
  assert.ok(viewStart >= 0, "EntityResearchView must exist for this test to mean anything");
  assert.ok(viewEnd > viewStart, "the slice's end anchor must still exist and follow its start");
  const view = margin.slice(viewStart, viewEnd);
  assert.match(view, /\{\.\.\.crossRefBranchHandlers\(`bref:v1\/\$\{ref\}`, target, onNavigate, onOpenPassageTab\)\}/);
  assert.match(view, /void onOpenPassageTab\(target\)/);
  assert.match(view, /aria-label=\{`Open \$\{label\} as a passage tab`\}/);
  assert.match(margin, /useVersePeek\(packageId, onKeepReference, onOpenPassageTab\)/);
});

test("Research names immutable provenance, current canvas, and unavailable entities", () => {
  assert.match(margin, /Opened from[\s\S]{0,120}?\{originLabel\}/);
  assert.match(margin, /currentCanvasDiffersFromOrigin[\s\S]{0,220}?Viewing[\s\S]{0,120}?\{currentCanvasLabel\}/);
  assert.match(margin, /entityIntent\?: \{[\s\S]{0,160}?displayName: string;[\s\S]{0,100}?kind: "person" \| "place" \| "other";/);
  assert.match(margin, /data-study-entity-unavailable=\{entityIntent\.id\}/);
  assert.match(margin, /title=\{`\$\{entityIntent\.displayName\} unavailable`\}/);
  assert.match(css, /\.entity-research-return\s*\{[\s\S]{0,300}?appearance: none;[\s\S]{0,300}?background: transparent;/);
  assert.match(css, /\.entity-research-provenance\s*\{[\s\S]{0,300}?align-items: flex-end;[\s\S]{0,300}?text-align: right;/);
});

test("principal research stays compact and deep datasets share one More disclosure", () => {
  const viewStart = margin.indexOf("return (", margin.indexOf("function EntityResearchView"));
  const moreStart = margin.indexOf('<details className="entity-research-more"', viewStart);
  const sourcesStart = margin.indexOf("<MarginSourcesDisclosure", moreStart);
  assert.ok(viewStart >= 0 && moreStart > viewStart && sourcesStart > moreStart);
  const principal = margin.slice(viewStart, moreStart);
  // C·2's six parts, in order, and nothing else. The 340×140 minimap that used
  // to sit in the principal view is gone: at 380px it was a decorative smudge
  // displacing the sentence that would have placed the reader. The bearing
  // fact row is built from the same coordinates and says more in 40px.
  for (const marker of [
    "entity-research-identity",
    "MarginEntryNameLine",
    "MarginEntryKindLine",
    "MarginEntryWhy",
    "MarginEntryFacts",
    "EntityOpeningContextSection",
    "MarginEntryAppearsIn",
    "MarginEntryRelated",
    "entity-research-capture",
  ]) {
    assert.ok(principal.includes(marker), `principal view missing ${marker}`);
  }
  assert.ok(!margin.includes("EntityMiniMap"), "the minimap returned to the 380px pane");
  assert.ok(
    principal.indexOf("MarginEntryNameLine") < principal.indexOf("MarginEntryKindLine")
      && principal.indexOf("MarginEntryKindLine") < principal.indexOf("MarginEntryWhy")
      && principal.indexOf("MarginEntryWhy") < principal.indexOf("MarginEntryFacts")
      && principal.indexOf("MarginEntryFacts") < principal.indexOf("MarginEntryAppearsIn")
      && principal.indexOf("MarginEntryAppearsIn") < principal.indexOf("MarginEntryRelated"),
    "the six parts render out of order",
  );
  for (const marker of ["PersonRelationships", "PleiadesResearchSection", "entity-reference-list"]) {
    assert.ok(!principal.includes(marker), `${marker} escaped More`);
  }
  const deep = margin.slice(moreStart, sourcesStart);
  assert.match(deep, /<summary>More<\/summary>/);
  for (const marker of ["{photo}", "PersonRelationships", "PleiadesResearchSection", "entity-reference-list"]) {
    assert.ok(deep.includes(marker), `More missing ${marker}`);
  }
});
