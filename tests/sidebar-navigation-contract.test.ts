import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("sidebar exposes one production density and one library-menu trigger", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");
  const api = readFileSync(join(repoRoot, "src", "renderer", "api.ts"), "utf-8");
  const main = readFileSync(join(repoRoot, "src", "electron", "main.ts"), "utf-8");
  const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");

  for (const source of [app, api, main, css]) {
    assert.doesNotMatch(source, /sidebarStyle|sidebar-style-|sidebar-lab|SIDEBAR_STYLES/);
  }

  assert.equal(
    app.match(/className=\{`library-switcher/g)?.length,
    1,
    "expected one library-menu trigger in the sidebar footer",
  );
  assert.match(app, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(app, /aria-label="Primary navigation"/);
  assert.match(app, /aria-expanded=\{!sidebarCollapsed\}/);
  assert.match(app, /<div className="sidebar-header">[\s\S]*<Tooltip label=\{sidebarCollapsed \? "Expand sidebar" : "Collapse sidebar"\}>[\s\S]*className="sidebar-collapse-btn"/);
  assert.match(app, /ariaLabel="Library menu"/);
  assert.doesNotMatch(css, /\.sidebar-collapse-btn\s*\{[\s\S]*right:\s*-11px/);
  assert.match(css, /\.sidebar\.collapsed \.sidebar-header:hover > \.control-tooltip-anchor/);
});

test("sidebar footer describes local state without implying remote sync", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");

  assert.match(app, /"Local library"/);
  assert.match(app, /"Studying passage…"/);
  assert.doesNotMatch(app, />Up to date</);
});
