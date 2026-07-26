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

test("the nav rail is canvas, and no row in it is ever a fill", () => {
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

  // State is a mark on a reserved gutter, never a fill. Every row keeps the
  // mark's width of space at BOTH edges whether or not it is carrying a mark,
  // so nothing moves when one appears and nothing is pushed off the rail's
  // centre by the reserve — the mark exists at rest and is simply transparent.
  //
  // REV 05 §05·3 REVISED STUDY A HERE, in two ways this test used to pin the
  // other side of:
  //
  //   1. The mark is 2px and reserved at both edges, not 3px at the leading one.
  //      Law 2 says 2px, both of §05·3's drawings say 2px, and the bottom bar's
  //      own test below already described itself as "the same 2px rule the rail
  //      uses" while the rail quietly used 3.
  //   2. The mark sits on the RIGHT edge. Law 2 puts it on the edge nearest the
  //      content it opens; the rail opens the page and the page is to its right.
  //      A's left-edge mark predates B·2's inset page — with 24px of canvas
  //      between rail and paper, a left-edge mark points away from the leaf it
  //      opened and fights the tile for the rail's left edge.
  //
  // The geometry is the section's, exactly: a 32px tile in a 56px rail, 12
  // either side, 2px of that 12 reserved at each edge. The inset is derived
  // from the two rail widths rather than written as 12, so it cannot drift.
  assert.match(css, /--mark-w: 2px;/);
  assert.match(css, /--rail-tile: 32px;/);
  assert.match(css, /--rail-tile-inset: calc\(\(var\(--rail-w-collapsed\) - var\(--rail-tile\)\) \/ 2\);/);
  assert.match(css, /\.nav-item \{[\s\S]{0,420}padding: 0 var\(--rail-tile-inset\);/);
  assert.match(css, /\.nav-item \{[\s\S]{0,420}min-height: var\(--band\);/);
  assert.match(css, /\.nav-item::before \{[\s\S]{0,240}inset: 0 0 0 auto;/);
  assert.match(css, /\.nav-item::before \{[\s\S]{0,240}width: var\(--mark-w\);[\s\S]{0,120}background: transparent;/);
  assert.match(css, /\.nav-item::before \{[\s\S]{0,240}background: transparent;/);
  assert.match(css, /\.nav-item\.active::before \{\s*background: var\(--study-gold\);\s*\}/);
  // The row's radius no longer ends a fill at the rail's edge, because there is
  // no fill; it is even on all four corners, and the only thing it still shapes
  // is the focus ring. A ring rounded on one side only is a leftover.
  assert.match(css, /\.nav-item \{[\s\S]{0,420}border-radius: var\(--radius-pebble\);/);
  // Nothing moves on hover: ink changes, geometry does not.
  assert.match(css, /\.nav-item:hover \{\s*background: none;\s*color: var\(--text-primary\);\s*\}/);
  // Active is instant on purpose — it is the app answering "where am I", and an
  // animated answer feels like a delayed one. It is ink and a mark and NOTHING
  // else: the paper that used to fill this row was a filled row wearing the
  // page's colour, which Law 2 bans by name, and §05·3 names it as half the
  // cause of the icon column reading off-centre.
  assert.match(css, /\.nav-item\.active \{\s*color: var\(--text-primary\);\s*transition: none;\s*\}/);

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
  //
  // This loop used to read `.theme-orb-{id}`, four one-line rules that each
  // struck that atmosphere's paper with that atmosphere's seal across one
  // corner. Both halves of that requirement have been retired, for the reason
  // the paragraph above gives about the ambers. The orb sits in a band that is
  // paper, so a chip of the current paper is 1.00:1 against the surface under
  // it and a chip of the current canvas is between 1.09:1 and 1.20:1 — no
  // plane it could show clears Law 6's 3:1 for a wordless mark — and the seal
  // it used to carry was
  // the authorship colour doing theme identity, which is precisely the job the
  // ambers were deleted for. The orb is now the instrument's own ink through
  // currentColor and names no value at all, which is asserted below instead.
  //
  // The swatches that DO paint an atmosphere they are not standing in are the
  // four in the picker, and the guarantee moves to them unchanged in kind: that
  // theme's paper, ringed in that theme's own ink-3, both read off the artifact
  // so neither can drift when the palette moves.
  for (const [id, atmosphere] of Object.entries(tokens.atmospheres)) {
    const selector = `.theme-swatch-${id}`;
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} is missing`);
    const rule = css.slice(at, css.indexOf("\n", at));
    const paper = tokens.plane[atmosphere.scope]!["--paper-solid"]!;
    const ink = tokens.ink[atmosphere.scope]!["--text-tertiary"]!;
    assert.ok(
      rule.toUpperCase().includes(paper.toUpperCase()),
      `${selector} must show that theme's paper (${paper})`,
    );
    assert.ok(
      rule.toUpperCase().includes(ink.toUpperCase()),
      `${selector} must be ringed in that theme's own ink-3 (${ink}), which is what carries Law 6 ` +
        `here: the fill cannot, because a paper swatch on paper is 1.00:1`,
    );
  }

  // The orb, stated as the absence it now is. A hex or an accent token
  // reappearing in this rule is the swatch idea coming back, and the swatch
  // idea is what read as broken at 16px.
  const orb = css.slice(css.indexOf(".theme-orb {"), css.indexOf("/* Living Margin toggle"));
  assert.match(orb, /background: currentColor/,
    "the orb is the instrument's own ink, so that it rests and hovers with the four words beside it");
  assert.doesNotMatch(orb, /#[0-9A-Fa-f]{3}|--accent-|--study-gold|linear-gradient/,
    "the orb may not name a colour of its own, and may not go back to a two-tone corner");

  // No swatch may survive for an atmosphere the app no longer offers.
  assert.doesNotMatch(
    css,
    /\.theme-orb-glass|\.theme-orb-dark-glass|\.theme-swatch-glass|\.theme-swatch-dark-glass|\.theme-preview-glass|\.theme-preview-dark-glass/,
  );
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
