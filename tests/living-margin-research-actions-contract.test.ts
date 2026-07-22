import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const margin = read("src/renderer/components/LivingMargin.tsx");
const css = read("src/renderer/styles.css");

test("opening-context references name same-tab navigation and expose a visible passage-tab branch", () => {
  const sectionStart = margin.indexOf("function EntityOpeningContextSection");
  const sectionEnd = margin.indexOf("const RELATIONSHIP_GROUPS", sectionStart);
  const section = margin.slice(sectionStart, sectionEnd);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  assert.match(section, /onOpenPassageTab\?: \(target: PeekTarget\) => Promise<boolean> \| boolean/);
  assert.match(section, /const label = formatResearchRef\(ref, bookNames\)/);
  assert.match(section, /const target = parsePeekRef\(ref, label\)/);
  assert.match(section, /className="entity-reference-actions is-opening"/);
  assert.match(section, /aria-label=\{`View \$\{label\} in this research tab`\}/);
  assert.match(section, /title="Follow in this Research tab"/);
  assert.match(section, /className="entity-reference-open-tab"/);
  assert.match(section, /void onOpenPassageTab\(target\)/);
  assert.match(section, /aria-label=\{`Open \$\{label\} as a passage tab`\}/);
  assert.match(section, />\s*Passage tab\s*</);

  const principalStart = margin.indexOf("<EntityOpeningContextSection");
  const principalEnd = margin.indexOf("/>", principalStart);
  assert.match(margin.slice(principalStart, principalEnd), /onOpenPassageTab=\{onOpenPassageTab\}/);
});

test("research drill and branch actions have a deliberate primary-secondary hierarchy", () => {
  assert.match(css, /\.entity-reference-actions,\s*\.entity-relationship-target-actions\s*\{[\s\S]{0,260}?display: inline-grid;[\s\S]{0,180}?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.entity-reference-grid \.entity-reference-actions > \.entity-reference-open-tab\s*\{[\s\S]{0,500}?min-height: 22px;[\s\S]{0,300}?color: var\(--text-tertiary\);[\s\S]{0,300}?font-family: var\(--font-mono\);/);
  assert.match(css, /\.entity-relationship-links \.entity-relationship-branch\s*\{[\s\S]{0,500}?min-height: 22px;[\s\S]{0,300}?color: var\(--text-tertiary\);[\s\S]{0,300}?font-family: var\(--font-mono\);/);
  assert.match(css, /\.entity-reference-open-tab:hover,\s*\.entity-relationship-branch:hover\s*\{[\s\S]{0,220}?background: color-mix\(in srgb, var\(--study-hover-surface\)/);
  assert.match(css, /\.entity-reference-open-tab:focus-visible,\s*\.entity-relationship-branch:focus-visible\s*\{[\s\S]{0,160}?outline: 2px solid var\(--study-gold-focus\);/);
});
