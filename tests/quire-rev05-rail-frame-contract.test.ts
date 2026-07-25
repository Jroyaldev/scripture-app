import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

/**
 * Quire Rev 05 §05·3 — "The rail joins the frame".
 *
 * B·2 stopped the rail's active row from bleeding, which was right, but it left
 * the rail measured against the window while everything else was measured
 * against the page. This file holds the three corrections that answer it, and
 * it holds them as RELATIONSHIPS rather than as numbers: the tile's inset is
 * derived from the rail's own two widths, the rail's top is the frame's top
 * token, and the account tile's bottom is the page inset. A number written by
 * hand in any of those places is a number that can drift away from the thing it
 * was supposed to equal, which is exactly how the rail acquired a second origin
 * in the first place.
 *
 * Study A is revised, not reinterpreted: A's left-edge mark predates the inset
 * page, and §05·3 says so in as many words — "a correction to A, not a new
 * device: same 2px, same seal, same reserve at rest."
 */

const repoRoot = resolve(import.meta.dirname, "..");
const read = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), "utf-8");

const STYLES = "src/renderer/styles.css";
const RAIL = "src/renderer/styles/rail.css";
const APP = "src/renderer/app.tsx";

/** Every (selector list, body) pair in a sheet, comments stripped from the head. */
function rules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match): [string, string] => [
    match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
    match[2]!,
  ]);
}

/**
 * Every declaration block whose selector list is exactly `selector`, in source
 * order — so `[0]` is the desktop rule and any later one is a media-query
 * override of it.
 */
function ruleBlocks(css: string, selector: string): string[] {
  const found = rules(css).filter(([head]) => head === selector).map(([, body]) => body);
  assert.notEqual(found.length, 0, `expected a rule for ${selector}`);
  return found;
}

/** The body of every `@media (max-width: 979px)` block in one string. */
function narrowShell(css: string): string {
  const marker = "@media (max-width: 979px)";
  let out = "";
  let from = css.indexOf(marker);
  while (from !== -1) {
    let depth = 0;
    let index = css.indexOf("{", from);
    const start = index;
    for (; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out += `${css.slice(start, index)}\n`;
    from = css.indexOf(marker, index);
  }
  assert.notEqual(out, "", "expected at least one narrow-shell block");
  return out;
}

test("the rail is bracketed by the same two lines as the paper", () => {
  const css = read(STYLES);

  // Top: the brand tile's top edge IS the page's top edge — 54, the same
  // number, composed by rev05-canon as 24 canvas + 30 strip. The rail names
  // that token rather than restating 54, so the two halves of the frame cannot
  // be edited apart. Anything else here is the rail keeping its own origin.
  assert.match(css, /--frame-top: calc\(var\(--page-inset\) \+ var\(--register-strip\)\);/,
    "the frame's top edge token is rev05-canon's; the rail consumes it");
  assert.match(ruleBlocks(css, ".sidebar")[0]!, /padding-top: var\(--frame-top\);/,
    "the rail's vertical origin must be the page's, not the window's");

  // The header therefore has no top padding of its own. Two origins stacked is
  // the drift §05·3 is about.
  assert.match(ruleBlocks(css, ".sidebar-header")[0]!, /padding: 0 var\(--rail-tile-inset\) 16px;/);

  // env(titlebar-area-height) was the rail's own datum, answerable to the
  // window. 54 clears the hiddenInset traffic lights by more than the 28 it
  // replaces, so nothing is bought back by keeping it.
  for (const [file, source] of [[STYLES, css], [RAIL, read(RAIL)]] as const) {
    for (const [selector, body] of [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      (m): [string, string] => [
        m[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
        m[2]!,
      ],
    )) {
      if (!/(?:^|[\s,>~])\.sidebar(?![\w-])/.test(selector)) continue;
      assert.doesNotMatch(body, /titlebar-area-height/,
        `${file}: ${selector} measures the rail's top against the window again`);
    }
  }

  // Bottom: the account tile's bottom edge is the page's bottom edge, 24 up
  // from the window — the page inset itself, not a 24 that happens to match.
  assert.match(
    ruleBlocks(css, ".sidebar-footer")[0]!,
    /padding: 12px var\(--rail-tile-inset\) var\(--page-inset\);/,
    "the account tile must end where the paper ends",
  );

  // Width stays 56 and stays flush to the window. The rail is ground, and
  // ground may touch the edge; only paper is inset. Insetting the rail would
  // make it a third plane, which Law 1 does not have.
  assert.match(ruleBlocks(css, ".sidebar.collapsed")[0]!, /width: var\(--rail-w-collapsed\);/);
  for (const body of ruleBlocks(css, ".sidebar")) {
    assert.doesNotMatch(body, /margin-left|margin-inline-start|inset-inline-start/,
      "the rail may not be inset from the window — that makes it a third plane");
  }

  // LEFT, in focus mode, which is the fourth edge and was the last wrong one.
  // Rev 05 §05·5: "The rectangle does not change. Top 54, left 80, right and
  // bottom 24 — identical to reading mode. The rail's 56px column stays as
  // canvas; it was ground all along, and ground with nothing on it is exactly
  // what focus wants." A4's 12px strip measured page-left at 36 — the same
  // complaint §05·5 opens with ("a 2px stub of the hidden rail is left on the
  // window's edge"), six times the size. The column stays; only its contents go.
  const rail = read(RAIL);
  const focusBand = ruleBlocks(
    rail,
    ".app-shell.focus-mode > .sidebar, .app-shell.focus-mode > .sidebar.collapsed",
  )[0]!;
  assert.match(focusBand, /width: var\(--rail-w-collapsed\);/,
    "focus must keep the rail's 56px column, or the page's left edge moves off 80");
  assert.match(focusBand, /min-width: var\(--rail-w-collapsed\);/);
  assert.doesNotMatch(focusBand, /12px/, "the 12px stub is retired");
  // padding-top is deliberately NOT reset here: the rectangle does not change,
  // so the tiles come back on the same 54 they left.
  assert.doesNotMatch(focusBand, /padding-top/,
    "focus must not give the rail a second vertical origin");

  // "No stub, no handle… nothing is drawn to advertise it. An affordance drawn
  // permanently in the calmest mode is the one thing focus cannot afford."
  // Focus stays reachable by ⌘\, Escape, the header's FOCUS instrument and the
  // command palette, so drawing nothing strands nobody.
  for (const [file, source] of [[RAIL, rail], [STYLES, css], [APP, read(APP)]] as const) {
    assert.doesNotMatch(source, /rail-focus-handle/,
      `${file}: §05·5 retired the focus grab handle; the 56px band is the affordance`);
  }

  // And the float back keeps the page still: the offset it gives back is the
  // band's own width, so the measure does not reflow when the rail returns.
  const floated = ruleBlocks(
    rail,
    ".app-shell.focus-mode > .sidebar:hover, .app-shell.focus-mode > .sidebar:focus-within, .app-shell.focus-mode > .sidebar.collapsed:hover, .app-shell.focus-mode > .sidebar.collapsed:focus-within",
  )[0]!;
  assert.match(floated, /margin-right: calc\(var\(--rail-w-collapsed\) - var\(--rail-w\)\);/,
    "the floated rail must give back exactly the band it covers, or the page reflows");
  assert.match(floated, /padding-top: var\(--frame-top\);/,
    "the floated rail returns to the frame's origin, not the window's");
});

test("one vertical axis runs through every tile in the rail", () => {
  const css = read(STYLES);

  // The axis is the rail's centre, and it is DERIVED: 56 less 32, halved. The
  // moment this is written as 12 it can drift away from the widths it halves.
  assert.match(css, /--rail-tile: 32px;/);
  assert.match(css, /--rail-tile-inset: calc\(\(var\(--rail-w-collapsed\) - var\(--rail-tile\)\) \/ 2\);/);
  assert.match(css, /--rail-label-x: calc\(var\(--rail-tile-inset\) \+ var\(--rail-tile\) \+ 8px\);/);

  // Every tile in the column is that one square: brand, the collapse control
  // that stands in its place, the nav rows' icon tile, and the account tile.
  // §05·6's caption is the whole test — "one vertical axis through every tile".
  for (const selector of [".brand-mark", ".sidebar-collapse-btn", ".nav-tile", ".footer-avatar"]) {
    const body = ruleBlocks(css, selector)[0]!;
    assert.match(body, /width: var\(--rail-tile\);/, `${selector} is not the rail's tile width`);
    assert.match(body, /height: var\(--rail-tile\);/, `${selector} is not the rail's tile height`);
  }

  // And every row that carries one starts at the same inset, at BOTH widths —
  // which is what stops the axis moving by 8px when the rail expands to 232.
  assert.match(ruleBlocks(css, ".nav-item")[0]!, /padding: 0 var\(--rail-tile-inset\);/);
  assert.match(
    ruleBlocks(css, ".sidebar.collapsed .sidebar-header")[0]!,
    /padding-left: var\(--rail-tile-inset\);\s*padding-right: var\(--rail-tile-inset\);/,
  );
  // The switcher carries no inset of its own: the footer's is the rail's, and a
  // second padding underneath the first is another way for a tile to drift.
  const switcher = ruleBlocks(css, ".library-switcher")[0]!;
  assert.match(switcher, /grid-template-columns: var\(--rail-tile\) minmax\(0, 1fr\) 14px;/);
  assert.match(switcher, /padding: 0;/);
  // The switcher's row is one tile tall in both widths. Measured, the two-line
  // library text is ~36px and sets the row's height if allowed to, which centres
  // the avatar 2px high and lands the account tile's bottom edge at 26 from the
  // window rather than the frame's 24. The tile owns the row; the second line is
  // air either side of it.
  assert.match(switcher, /grid-template-rows: var\(--rail-tile\);/);
  assert.match(ruleBlocks(css, ".sidebar.collapsed .library-switcher")[0]!, /height: var\(--rail-tile\);/);

  // Collapsed, the label is zero-width but is still a flex item, so a surviving
  // gap after the tile drags the tile half of it off the axis. Both collapsed
  // rows have to zero it — this is the one place the geometry is fragile, so it
  // is the one place a test earns its keep.
  assert.match(ruleBlocks(css, ".sidebar.collapsed .nav-item")[0]!, /gap: 0;/);
  assert.match(ruleBlocks(css, ".sidebar.collapsed .library-switcher")[0]!, /gap: 0;/);

  // The old 30px tiles are gone from the rail entirely. A 30 anywhere in this
  // column is a tile that has fallen off the axis by a pixel each side.
  for (const selector of [".brand-mark", ".sidebar-collapse-btn", ".footer-avatar", ".nav-tile"]) {
    assert.doesNotMatch(ruleBlocks(css, selector)[0]!, /(?:width|height): 30px;/);
  }

  // The rail has one label column too, and it is the tile's right edge plus 8 —
  // so the brand word, the nav labels, the held line, the study block and the
  // library's name all begin on one x.
  const rail = read(RAIL);
  assert.match(ruleBlocks(css, ".brand-row")[0]!, /gap: 8px;/);
  assert.match(ruleBlocks(css, ".nav-item")[0]!, /gap: 8px;/);
  for (const selector of [".rail-held", ".rail-study-kicker", ".rail-study-list"]) {
    assert.match(ruleBlocks(rail, selector)[0]!, /var\(--rail-label-x\)/,
      `${selector} left the rail's label column behind`);
  }
});

test("the active mark is on the right edge, its reserve is present at rest, and no row is a fill", () => {
  const css = read(STYLES);

  // Law 2: a 2px seal mark on the edge nearest the content it opens. The rail
  // opens the page and the page is to its right, so the mark is on the right —
  // Rev 05 §05·3's correction to Study A, whose left-edge mark predates B·2's
  // inset page. Same 2px, same seal, same reserve: only the edge changed.
  assert.match(css, /--mark-w: 2px;/);
  const mark = ruleBlocks(css, ".nav-item::before")[0]!;
  assert.match(mark, /inset: 0 0 0 auto;/, "the mark sits on the rail's right edge");
  assert.match(mark, /width: var\(--mark-w\);/);
  // Reserved at rest: the mark exists on every row and is simply transparent,
  // which is what makes the row hold still when it lights up.
  assert.match(mark, /background: transparent;/);
  assert.match(css, /\.nav-item\.active::before \{\s*background: var\(--study-gold\);\s*\}/);

  // State is a mark and NEVER a fill. The paper that used to fill the active row
  // was a filled row wearing the page's colour — a tinted chip by another name —
  // and §05·3 names it as half the cause of the icon column reading off-centre:
  // "by 2px of geometry and much more of apparent weight".
  for (const [selector, body] of [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m): [string, string] => [
      m[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
      m[2]!,
    ],
  )) {
    if (!/(?:^|[\s,>~])\.nav-item(?![\w-])/.test(selector)) continue;
    if (/::before/.test(selector)) continue;
    for (const value of [...body.matchAll(/(?:^|[\s;])background(?:-color)?:\s*([^;]+);/g)].map(
      (m) => m[1]!.trim(),
    )) {
      assert.match(value, /^(?:transparent|none)$/,
        `${selector} gives a nav row a fill (${value}) — Law 2 says state is a mark`);
    }
  }
});

test("the narrow shell still wins the rail, and a collapsed rail can no longer strand a reader", () => {
  const css = read(STYLES);
  const narrow = narrowShell(css);

  // Below 979 the rail is a bottom bar, and the mark moves to the edge nearest
  // the page again — which there is the top. Same rule, third shell.
  assert.match(narrow, /\.sidebar,\s*\.sidebar\.collapsed \{[^}]*height: 56px;/);
  assert.match(narrow, /\.nav-item::before \{[^}]*inset: 0 0 auto 0;/);
  assert.match(narrow, /\.nav-item::before \{[^}]*height: 2px;/);
  assert.match(narrow, /\.nav-item \{[^}]*flex-direction: column;/);

  // Specificity ignores media queries, so `.sidebar.collapsed .nav-label` — three
  // classes, declared for the desktop rail — out-specifies the narrow shell's
  // `.nav-item .nav-label` and hides the labels in the bottom bar. Two more rules
  // lost the same fight: the row's gap and the unread dot's position. The fix is
  // not a cascade fight but the absence of one — the class is withheld below the
  // breakpoint, so there is nothing left to out-specify.
  //
  // It matters because there is no way back: `.sidebar-header` holds the only
  // collapse control and is `display: none` here, so a reader who collapsed the
  // rail on a desktop used to open the app on a phone to an unlabelled icon bar
  // with no undo. §H2: an unlabelled icon bar is a memory test.
  const app = read(APP);
  assert.match(app, /const NARROW_SHELL = "\(max-width: 979px\)";/,
    "the guard's breakpoint must be the stylesheet's");
  // (`collapsedRail`, not `railCollapsed`: the retired marking surfaces' trace
  // scan bans any `rail[A-Z]…` identifier in the renderer, and a nav-rail
  // helper must not read as one of them coming back.)
  assert.match(app, /const collapsedRail = sidebarCollapsed && !narrowShell;/);
  assert.match(app, /className=\{`sidebar\$\{collapsedRail \? " collapsed" : ""\}`\}/,
    "the rail's collapsed class must come from the guarded value, not the raw setting");
  // The preference itself is untouched — only its effect while there is no room
  // to honour it — so widening the window restores the reader's own choice.
  assert.match(app, /void safeCall\(\(\) => window\.api\.settings\.set\(\{ sidebarCollapsed \}\)\);/);
  assert.match(app, /aria-expanded=\{!sidebarCollapsed\}/);
  assert.match(narrow, /\.sidebar-header,[\s\S]{0,120}display: none;/);
});
