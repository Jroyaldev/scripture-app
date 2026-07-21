import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

test("the durable token artifact matches the rendered desktop system", () => {
  const tokens = JSON.parse(read("src/renderer/design-tokens.json")) as {
    color: { bg: Record<string, string>; text: Record<string, string> };
    atmospheres: Record<string, { name: string; mode: string; asset: string | null }>;
    radius: Record<string, string>;
    shadow: Record<string, string>;
    transition: Record<string, string>;
    layout: Record<string, string>;
  };
  const css = read("src/renderer/styles.css");

  assert.equal(tokens.color.bg.primary, "#F3EDE0");
  assert.equal(tokens.color.text.primary, "#181511");
  assert.deepEqual(tokens.radius, { sm: "6px", md: "12px", lg: "20px" });
  assert.equal(tokens.transition.fast, "150ms ease");
  assert.equal(tokens.layout.sidebarWidth, "228px");
  assert.equal(tokens.layout.sidebarRailWidth, "64px");
  assert.deepEqual(
    Object.entries(tokens.atmospheres).map(([id, value]) => [id, value.name]),
    [
      ["light", "Paper"],
      ["dark", "Ink"],
      ["glass", "Glass"],
      ["dark-glass", "Candlelight"],
    ],
  );
  assert.equal(tokens.atmospheres.glass.asset, "assets/glass-light.png");
  assert.equal(tokens.atmospheres["dark-glass"]?.asset, "assets/glass-dark.png");
  assert.equal(existsSync(join(repoRoot, "src/renderer/assets/glass-light.png")), true);
  assert.equal(existsSync(join(repoRoot, "src/renderer/assets/glass-dark.png")), true);

  assert.match(css, /--radius-sm: 6px/);
  assert.match(css, /--radius-md: 12px/);
  assert.match(css, /--radius-lg: 20px/);
  assert.match(css, /--bg-float:/);
  assert.match(css, /--scrim-subtle:/);
  assert.match(css, /--scrim-strong:/);
  assert.match(css, /--shadow-sidecar:/);
  assert.doesNotMatch(css, /border-radius:\s*(?:6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)px/);
  assert.doesNotMatch(css, /#9464b4|rgba\(148, 100, 180/);
});

test("desktop components keep only data-driven inline styles and no native dialogs", () => {
  const componentDir = join(repoRoot, "src/renderer/components");
  const sources = [
    read("src/renderer/app.tsx"),
    ...readdirSync(componentDir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => read(`src/renderer/components/${name}`)),
  ].join("\n");

  assert.doesNotMatch(sources, /style=\{\{\s*(?:display|position|cursor)\s*:/);
  assert.doesNotMatch(sources, /stroke="#[0-9A-Fa-f]{3,8}"/);
  assert.doesNotMatch(sources, /\balert\(|window\.confirm\(|\bconfirm\(/);
  assert.match(sources, /style=\{\{\s*top: position\.top,\s*left: position\.left,\s*width: position\.width,\s*maxHeight: position\.maxHeight/);
  assert.match(sources, /style=\{\{ "--sense-color": vizColor\(index\) \}/);
  assert.match(sources, /top:\s*placement\?\.top \?\? effectiveStageBounds\.top \+ 8/);
  assert.match(sources, /left:\s*placement\?\.left \?\? effectiveStageBounds\.left \+ 8/);
  assert.match(sources, /visibility:\s*placement \? "visible" : "hidden"/);
  assert.doesNotMatch(sources, /top:\s*selection\.position\.y,\s*left:\s*selection\.position\.x/);
});

test("library and claim writes expose busy, failure, and confirmed-success states", () => {
  const app = read("src/renderer/app.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");

  assert.match(app, /safeCall\(\(\) => window\.api\.library\.revealInFinder\(\)\)/);
  assert.match(app, /safeCall\(\(\) => window\.api\.dialog\.openDirectory\(\)\)/);
  assert.match(app, /safeCall\(\(\) => window\.api\.library\.init\(chosen\)\)/);
  assert.match(app, /aria-busy=\{libraryAction === "reveal"\}/);
  assert.match(app, /className="library-popover-error" role="alert"/);

  assert.match(margin, /const saved = await onPinClaim\(claimId, assertion\)/);
  assert.match(margin, /if \(!saved\)/);
  assert.match(margin, /setPinnedClaims/);
  assert.match(margin, /aria-busy=\{pendingClaimId === claim\.id\}/);
  assert.match(margin, /Your library was not changed/);
});

test("the aggregate desktop tour retains every bounded interaction suite", () => {
  const qa = read("scripts/qa-desktop-regression.mjs");
  for (const script of [
    "qa-sidebar-tour.mjs",
    "qa-topbar-tour.mjs",
    "qa-reading-canvas-tour.mjs",
    "qa-living-margin-tour.mjs",
    "qa-shared-controls-tour.mjs",
    "qa-setup-tour.mjs",
    "qa-note-workspace-tour.mjs",
    "qa-study-overlays-tour.mjs",
  ]) {
    assert.match(qa, new RegExp(script.replaceAll(".", "\\.")));
  }
});
