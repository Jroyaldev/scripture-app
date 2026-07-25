import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { THEME_OPTIONS, isDarkTheme, type AppTheme } from "../src/renderer/theme.js";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

interface TokenArtifact {
  atmospheres: Record<string, { name: string; scope: string; tone: string; temperature: string }>;
  material: Record<string, { name: string; scope: string | null }>;
  plane: Record<string, Record<string, string>>;
  ink: Record<string, Record<string, string>>;
  hairline: Record<string, Record<string, string>>;
  accent: Record<string, Record<string, string>>;
  shadow: Record<string, Record<string, string>>;
  scrim: Record<string, Record<string, string>>;
  radius: Record<string, string>;
  motion: Record<string, Record<string, string>>;
  typography: Record<string, string>;
  spacing: Record<string, string>;
  layout: Record<string, string>;
  highlight: Record<string, Record<string, string>>;
  status: Record<string, string>;
}

/**
 * The declarations a single scope block in styles.css actually makes. The
 * artifact is checked against these rather than against a loose /--token:/
 * regex, so a value declared under the wrong theme cannot pass.
 */
function declaredTokens(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `styles.css declares no ${selector} block`);
  assert.equal(
    css.split(`${selector} {`).length - 1,
    1,
    `${selector} must be declared exactly once, or the artifact cannot say which block it mirrors`,
  );
  const end = css.indexOf("\n}", start);
  assert.ok(end > start, `${selector} block is unterminated`);
  const body = css.slice(start, end);
  assert.doesNotMatch(body.slice(selector.length + 2), /\{/, `${selector} block must be flat declarations`);
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    declared.set(match[1]!, match[2]!.trim());
  }
  return declared;
}

test("the durable token artifact matches the rendered desktop system", () => {
  const tokens = JSON.parse(read("src/renderer/design-tokens.json")) as TokenArtifact;
  const css = read("src/renderer/styles.css");

  // Every value the artifact records must be the value the stylesheet declares,
  // in the scope the artifact claims. This is the whole point of the file: it is
  // a parallel artifact, so drift in either direction is a failure.
  const groups = [tokens.plane, tokens.ink, tokens.hairline, tokens.accent, tokens.shadow, tokens.scrim, tokens.motion, tokens.highlight];
  let checked = 0;
  for (const group of groups) {
    for (const [selector, table] of Object.entries(group)) {
      const declared = declaredTokens(css, selector);
      for (const [name, value] of Object.entries(table)) {
        assert.equal(declared.get(name), value, `${selector} { ${name} } drifted from styles.css`);
        checked += 1;
      }
    }
  }
  for (const table of [tokens.radius, tokens.typography, tokens.spacing, tokens.layout, tokens.status]) {
    const declared = declaredTokens(css, ":root");
    for (const [name, value] of Object.entries(table)) {
      assert.equal(declared.get(name), value, `:root { ${name} } drifted from styles.css`);
      checked += 1;
    }
  }
  assert.ok(checked > 220, `the artifact must still describe the system, not a handful of it (checked ${checked})`);

  // --- Two planes, and only two. -----------------------------------------
  // Paper is anything you read or work in; canvas is the ground everything
  // else recedes into. --bg-surface/--bg-sidebar/--bg-topbar were the third,
  // fourth and fifth fills, and they are deleted — not merely unreferenced.
  for (const deleted of ["--bg-surface", "--bg-sidebar", "--bg-topbar"] as const) {
    assert.doesNotMatch(css, new RegExp(`${deleted}\\s*:`), `${deleted} is a deleted token`);
    assert.doesNotMatch(css, new RegExp(`var\\(${deleted}`), `${deleted} is a deleted token`);
    for (const table of Object.values(tokens.plane)) {
      assert.equal(Object.hasOwn(table, deleted), false, `${deleted} must not reappear in the artifact`);
    }
  }
  for (const [id, atmosphere] of Object.entries(tokens.atmospheres)) {
    const plane = tokens.plane[atmosphere.scope];
    assert.ok(plane, `${id} declares no plane table`);
    const paper = plane["--bg-reading"];
    const ground = plane["--bg-canvas"];
    assert.ok(paper && ground, `${id} must declare both planes`);
    assert.notEqual(paper, ground, `${id} must keep paper and ground apart`);
    assert.equal(plane["--paper-solid"], paper, `${id}: --paper-solid is the opaque twin of paper`);
    assert.equal(plane["--canvas-solid"], ground, `${id}: --canvas-solid is the opaque twin of ground`);
    assert.equal(plane["--bg-primary"], ground, `${id}: the shell behind everything is ground by definition`);
    assert.equal(plane["--bg-float"], paper, `${id}: a float is paper that has left the page`);
  }
  // Material applies to the ground only. If translucency ever reached paper the
  // reading plane would stop being the brightest thing on screen.
  const translucent = tokens.plane[".material-translucent"]!;
  assert.match(translucent["--bg-canvas"]!, /color-mix\(in srgb, var\(--canvas-solid\) 42%, transparent\)/);
  assert.equal(Object.hasOwn(translucent, "--bg-reading"), false, "paper is opaque in every material");
  assert.doesNotMatch(
    declaredTokens(css, ".material-translucent").get("--bg-primary") ?? "",
    /transparent/,
    "the shell stays opaque so there is something for the ground to be translucent against",
  );

  // --- Two accents, not four. --------------------------------------------
  // SEAL says a human wrote this; SLATE says the app inferred it.
  for (const [id, atmosphere] of Object.entries(tokens.atmospheres)) {
    const accent = tokens.accent[atmosphere.scope]!;
    assert.ok(accent, `${id} declares no accent table`);
    const seal = accent["--accent-seal"];
    assert.ok(seal, `${id} must declare --accent-seal`);
    assert.ok(accent["--accent-seal-strong"], `${id} must declare --accent-seal-strong`);
    assert.ok(accent["--accent-machine"], `${id} must declare --accent-machine`);
    assert.notEqual(accent["--accent-machine"], seal, `${id}: the machine hue must not collapse into the seal`);
    assert.equal(accent["--study-gold"], seal, `${id}: --study-gold is the seal under its shipped name`);
    assert.equal(accent["--accent-current"], seal, `${id}`);
    assert.equal(accent["--accent-user"], seal, `${id}`);
    assert.equal(accent["--accent-ai"], accent["--accent-machine"], `${id}: inference is slate`);
    assert.equal(accent["--accent-source"], accent["--accent-machine"], `${id}: provenance is slate`);
  }
  assert.doesNotMatch(css, /#9464b4|rgba\(148, 100, 180/);

  // --- The radius family. -------------------------------------------------
  assert.deepEqual(tokens.radius, {
    "--radius-mark": "2px",
    "--radius-pebble": "4px",
    "--radius-sm": "6px",
    "--radius-page": "8px",
    "--radius-md": "8px",
    "--radius-window": "10px",
    "--radius-lg": "12px",
    "--radius-modal": "12px",
  });
  // --- Motion. Ink moves in 120, panes in 180, nothing else moves. --------
  const motion = tokens.motion[":root"]!;
  assert.match(motion["--transition-fast"]!, /^120ms /);
  assert.match(motion["--transition-normal"]!, /^180ms /);
  assert.equal(motion["--transition-slow"], "0ms");
  assert.equal(motion["--transition-instant"], "0ms");
  assert.equal(motion["--material-blur"], "0px", "solid is the absence of material, not a small amount of it");
  assert.equal(tokens.motion[".material-translucent"]!["--material-blur"], "26px");

  // --- The artifact's atmosphere list is the one the app actually offers. --
  assert.deepEqual(
    Object.entries(tokens.atmospheres).map(([id, value]) => [id, value.name, value.tone, value.temperature]),
    THEME_OPTIONS.map((option) => [option.id, option.label, option.tone, option.temperature]),
  );
  for (const [id, atmosphere] of Object.entries(tokens.atmospheres)) {
    assert.equal(atmosphere.tone === "dark", isDarkTheme(id as AppTheme), `${id} tone must agree with isDarkTheme`);
  }
  assert.deepEqual(Object.keys(tokens.material), ["solid", "translucent"]);
  assert.equal(tokens.material.translucent!.scope, ".material-translucent");
  assert.equal(tokens.material.solid!.scope, null, "solid is the default, so it owns no selector");
  // Glass and Candlelight were never atmospheres; they were this material.
  assert.doesNotMatch(css, /\.theme-glass\b|\.theme-dark-glass\b/);
});

test("the nav rail is canvas, and its active row is the only paper in it", () => {
  const css = read("src/renderer/styles.css");

  // The rail IS canvas. Not a tinted panel beside the page: no fill of its own
  // and no right border, because the page's 24px inset already separates them
  // with interval, which divides two planes better than a line does.
  assert.match(css, /\.sidebar \{[\s\S]{0,600}background: transparent;/);
  for (const [selector, body] of [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m): [string, string] => [
    m[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    m[2]!,
  ])) {
    if (!/(?:^|[\s,>~])\.sidebar(?![\w-])/.test(selector)) continue;
    assert.doesNotMatch(body, /border-right/, `${selector} puts the rail's right border back`);
    for (const value of [...body.matchAll(/(?:^|[\s;])background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim())) {
      assert.match(value, /^(?:transparent|none)$/, `${selector} gives the rail a fill of its own (${value})`);
    }
  }
  // 232 expanded, 56 collapsed, nothing in between: an intermediate width is a
  // width nobody chose.
  assert.match(css, /\.sidebar \{[\s\S]{0,120}width: var\(--rail-w\);/);
  assert.match(css, /\.sidebar\.collapsed \{\s*width: var\(--rail-w-collapsed\);\s*\}/);

  // State is a mark on a reserved gutter, never a fill. Every row keeps 3px at
  // its leading edge whether or not it is carrying a mark, so nothing moves
  // when one appears — the mark exists at rest and is simply transparent.
  assert.match(css, /--mark-w: 3px;/);
  assert.match(css, /\.nav-item \{[\s\S]{0,420}padding: 0 12px 0 calc\(var\(--mark-w\) \+ 9px\);/);
  assert.match(css, /\.nav-item \{[\s\S]{0,420}min-height: var\(--band\);/);
  assert.match(css, /\.nav-item::before \{[\s\S]{0,240}width: var\(--mark-w\);[\s\S]{0,120}background: transparent;/);
  assert.match(css, /\.nav-item::before \{[\s\S]{0,240}background: transparent;/);
  assert.match(css, /\.nav-item\.active::before \{\s*background: var\(--study-gold\);\s*\}/);
  // Rows run the rail's full width so the active one can end in its pebble at
  // the rail's edge — three scales of one material: pebble 4, tab 8, page 8.
  assert.match(css, /\.nav-item \{[\s\S]{0,420}border-radius: 0 var\(--radius-pebble\) var\(--radius-pebble\) 0;/);
  // Nothing moves on hover: ink changes, geometry does not.
  assert.match(css, /\.nav-item:hover \{\s*background: none;\s*color: var\(--text-primary\);\s*\}/);
  // The active fill is instant on purpose — it is the app answering "where am
  // I", and an animated answer feels like a delayed one.
  assert.match(css, /\.nav-item\.active \{\s*background: var\(--bg-reading\);\s*color: var\(--text-primary\);\s*transition: none;\s*\}/);

  // Work the app is doing is not a property of who you are, and a pulsing
  // identity cannot say what it is working on.
  assert.match(css, /\.footer-avatar\.analyzing \{\s*animation: none;\s*\}/);
  assert.match(css, /\.footer-ai-status\.analyzing \.footer-ai-dot \{[\s\S]{0,160}animation: none;/);
  // Slate, not amber: the app inferring something is provenance, not a warning.
  assert.match(css, /\.footer-ai-status\.analyzing \{\s*color: var\(--accent-machine\);\s*\}/);
});

test("every radius in the family band names a token instead of a literal", () => {
  const css = read("src/renderer/styles.css");
  // Literal radii are how a family drifts. Anything in the 6–20px band has to
  // name one of --radius-sm/page/md/window/lg, so the page, the tab and the
  // fillet cannot fall out of step. Below the band a mark is allowed its own
  // number, and a pill is 999px or 50% — neither is a member of the family.
  assert.doesNotMatch(css, /border-radius:\s*(?:6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)px/);
});

test("the deleted bright ambers survive nowhere, including the swatches that advertise a theme", () => {
  const css = read("src/renderer/styles.css");
  const tokens = JSON.parse(read("src/renderer/design-tokens.json")) as TokenArtifact;

  // Porcelain and Onyx used to carry a bright amber. That value was saying
  // "this is the crisp theme" instead of "you wrote this", and the accent's job
  // is authorship, not theme identity. A swatch is not exempt: the orb in the
  // toolbar and the preview in the picker are the first accent a reader ever
  // sees, so an amber left there re-advertises the deleted decision.
  assert.doesNotMatch(css, /#B87D1C/i, "the deleted Porcelain amber must not survive anywhere in the sheet");
  assert.doesNotMatch(css, /#E8A33D/i, "the deleted Onyx amber must not survive anywhere in the sheet");

  // Every swatch has to be painted out of the values its theme really declares,
  // which is the only thing that keeps the picker honest as the palette moves.
  const orbs = css.slice(css.indexOf(".theme-orb-light"), css.indexOf("/* Living Margin toggle"));
  for (const [id, atmosphere] of Object.entries(tokens.atmospheres)) {
    const selector = `.theme-orb-${id}`;
    const at = orbs.indexOf(selector);
    assert.ok(at >= 0, `${selector} is missing`);
    const rule = orbs.slice(at, orbs.indexOf("\n", at));
    const seal = tokens.accent[atmosphere.scope]!["--accent-seal"]!;
    const paper = tokens.plane[atmosphere.scope]!["--paper-solid"]!;
    assert.ok(
      rule.toUpperCase().includes(seal.toUpperCase()),
      `${selector} must be struck with that theme's seal (${seal}), not a colour of its own`,
    );
    assert.ok(
      rule.toUpperCase().includes(paper.toUpperCase()),
      `${selector} must show that theme's paper (${paper})`,
    );
  }
  // No swatch may survive for an atmosphere the app no longer offers.
  assert.doesNotMatch(css, /\.theme-orb-glass|\.theme-orb-dark-glass|\.theme-preview-glass|\.theme-preview-dark-glass/);
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
  // The sense spine's colour is a constant, so it moved out of the style
  // attribute into CSS. Only genuinely data-driven values may stay inline.
  assert.doesNotMatch(sources, /style=\{\{ "--sense-color"/);
  assert.match(read("src/renderer/styles.css"), /\.lang-sense-primary \{\s*--sense-color: var\(--study-gold\);/);
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
