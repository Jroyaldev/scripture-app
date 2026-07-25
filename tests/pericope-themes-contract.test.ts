import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isDarkTheme, migrateLegacyTheme, THEME_OPTIONS } from "../src/renderer/theme.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

const STYLES = "src/renderer/styles.css";
const PARTIALS = [
  "canvas", "margin-entries", "marking-actions", "mobile",
  "rail", "register", "search", "themes",
].map((name) => `src/renderer/styles/${name}.css`);

test("Pericope exposes four atmospheres on two axes, and a material that is not one", () => {
  assert.deepEqual(THEME_OPTIONS.map((option) => option.id), [
    "light", "dark", "porcelain", "onyx",
  ]);

  // Temperature crossed with luminance, each cell filled exactly once. Glass
  // and Candlelight never occupied a cell — they were Paper and Ink with the
  // material on, which is why they are gone from this list.
  const axes = THEME_OPTIONS.map((option) => `${option.temperature}/${option.tone}`).sort();
  assert.deepEqual(axes, ["cool/dark", "cool/light", "warm/dark", "warm/light"]);

  assert.equal(isDarkTheme("onyx"), true);
  assert.equal(isDarkTheme("dark"), true);
  assert.equal(isDarkTheme("porcelain"), false);
  assert.equal(isDarkTheme("light"), false);
});

test("readers on the retired glass themes are migrated, not reset", () => {
  // They did express a preference; dropping them back to a solid Paper would
  // silently discard it.
  assert.deepEqual(migrateLegacyTheme("glass"), { theme: "light", material: "translucent" });
  assert.deepEqual(migrateLegacyTheme("dark-glass"), { theme: "dark", material: "translucent" });
  assert.equal(migrateLegacyTheme("light"), null);
  assert.equal(migrateLegacyTheme("nonsense"), null);

  const main = read("src/electron/main.ts");
  assert.match(main, /function normalizeTheme/);
  assert.match(main, /LEGACY_THEME_MIGRATION/);
  // Both doors into the store must migrate: the live settings path and the
  // legacy-config adoption path.
  assert.match(main, /theme:\s*normalizeTheme\(partial\.theme \?\? store\.store\.theme\)/);
  assert.match(main, /theme:\s*normalizeTheme\(legacyTheme\)/);
  assert.match(main, /material:\s*normalizeMaterial\(undefined, legacyTheme\)/);
});

test("no atmosphere carries a bright amber, because the accent means authorship", () => {
  const css = read("src/renderer/styles.css");

  // Porcelain and Onyx used to say "this is the crisp theme" with #B87D1C and
  // #E8A33D. The accent's only job is "you wrote this", so it cannot also be
  // carrying theme identity.
  assert.doesNotMatch(css, /#E8A33D/i, "the Porcelain/Onyx amber must not return");
  assert.doesNotMatch(css, /#B87D1C/i, "the Porcelain stroke amber must not return");

  // Every atmosphere declares both accents, and the seal is the same value
  // under both of its names.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    const block = themeBlock(css, scope);
    const seal = declaration(block, "--accent-seal");
    assert.ok(seal, `${scope} must declare --accent-seal`);
    assert.equal(declaration(block, "--study-gold"), seal,
      `${scope}: --study-gold is the seal under its shipped name`);
    assert.ok(declaration(block, "--accent-machine"), `${scope} must declare --accent-machine`);
  }

  // Two accent values, not four. Deleting the ambers was only half the fix:
  // giving Porcelain and Onyx a *quieter* gold of their own is the same
  // mistake at lower volume, because the value still changes when the theme
  // changes and therefore still reads as theme identity. One brand hue at two
  // lightnesses, chosen by the contrast requirement rather than by
  // temperature — so the light pair share a seal and the dark pair share one,
  // and the same holds for the machine hue.
  for (const [light, dark] of [[":root", ".dark"], [".theme-porcelain", ".theme-onyx"]] as const) {
    for (const name of ["--accent-seal", "--accent-seal-strong", "--accent-machine"] as const) {
      assert.equal(
        declaration(themeBlock(css, ".theme-porcelain"), name),
        declaration(themeBlock(css, ":root"), name),
        `Porcelain must carry Paper's ${name}: an accent that changes with the theme is theme identity`,
      );
      assert.equal(
        declaration(themeBlock(css, ".theme-onyx"), name),
        declaration(themeBlock(css, ".dark"), name),
        `Onyx must carry Ink's ${name}: an accent that changes with the theme is theme identity`,
      );
    }
    // And the two polarities must genuinely differ, or "two values" is one.
    assert.notEqual(
      declaration(themeBlock(css, light), "--accent-seal"),
      declaration(themeBlock(css, dark), "--accent-seal"),
    );
  }

  // A link is the seal under a third name in every atmosphere. Porcelain and
  // Onyx had it as slate, which says "the app inferred this" about the one
  // thing on the page the reader is meant to act on.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    const block = themeBlock(css, scope);
    assert.equal(declaration(block, "--text-link"), declaration(block, "--accent-seal"),
      `${scope}: a link is the seal, never the machine hue`);
  }

  // The seal must clear 3:1 against its own paper, so a 2px mark is legible.
  for (const [scope, paper] of [
    [":root", "#FCFBF8"], [".theme-porcelain", "#FFFFFF"],
    [".dark", "#1D1B18"], [".theme-onyx", "#1C1C20"],
  ] as const) {
    const seal = declaration(themeBlock(css, scope), "--accent-seal")!;
    assert.ok(contrastRatio(seal, paper) >= 3,
      `${scope}: seal ${seal} on ${paper} is ${contrastRatio(seal, paper).toFixed(2)}:1, needs 3:1`);
  }

  // This assertion used to REQUIRE the opposite of what it now forbids: it
  // pinned `.connection-kind-parallel { --connection-ink: var(--mark-parallel) }`
  // and so froze a six-hue per-connection palette into the contract. D·2 names
  // that as the overlay's fourth defect — "hue is doing structural work…
  // two arbitrary hues become five, then the page has a legend it never shows"
  // — and answers it with "Seal, and only ever seal… there is no
  // per-connection palette, because only one connection is ever coloured at a
  // time." It sat in a test about the seal being the app's one authorship
  // colour, which is the very rule the palette was breaking.
  for (const kind of ["parallel", "contrast", "echo", "mirror", "series", "hinge"]) {
    assert.doesNotMatch(
      css,
      new RegExp(`\\.connection-kind-${kind}\\s*\\{[^}]*--connection-ink`),
      `a connection may not take a hue from its kind: seal is authorship, and ${kind} is not a person`,
    );
  }
  assert.match(css, /\.connection-mark\.focused,[\s\S]{0,400}--connection-ink: var\(--study-gold\);/);
});

test("the quiet ink clears AA in every atmosphere, under both of its names", () => {
  const css = read(STYLES);

  // Ink-3 is not decoration. It carries nearly every piece of mono chrome in
  // the app at 8–10px, and since §E turned the header's instruments into words
  // it is the ink the reader actually reads state off. As drawn it measured
  // 3.22:1 on Paper, which is a legibility failure dressed as restraint.
  //
  // The bar here is 4.5:1 — the AA threshold for body-sized text, applied to
  // type well below it, because that is what the token is now being asked to
  // do. The shipped values sit at 4.61–4.64 rather than on the line, since
  // subpixel antialiasing on 9px mono eats the margin at the threshold and a
  // token that only just passes will not survive its next nudge.
  //
  // --accent-xref is byte-identical to --text-tertiary in all four
  // atmospheres and inks cross-reference text, so it is checked here too: if
  // it were ever left behind, cross-refs would sit at the old ratio while
  // every other quiet label lifted, and the ramp would visibly fork.
  for (const [scope, paper] of [
    [":root", "#FCFBF8"], [".theme-porcelain", "#FFFFFF"],
    [".dark", "#1D1B18"], [".theme-onyx", "#1C1C20"],
  ] as const) {
    const block = themeBlock(css, scope);
    for (const name of ["--text-tertiary", "--accent-xref"] as const) {
      const ink = declaration(block, name);
      assert.ok(ink, `${scope} must declare ${name}`);
      assert.ok(contrastRatio(ink, paper) >= 4.5,
        `${scope}: ${name} ${ink} on ${paper} is ${contrastRatio(ink, paper).toFixed(2)}:1, needs 4.5:1`);
    }
    assert.equal(declaration(block, "--accent-xref"), declaration(block, "--text-tertiary"),
      `${scope}: a cross-reference is ink-3, so the two names must stay one value`);
  }
});

test("paper is the brightest plane in every atmosphere, including both darks", () => {
  const css = read("src/renderer/styles.css");

  // The law nobody wrote down, now written down. In all four atmospheres the
  // reading surface is lighter than the ground behind it — in the dark pair
  // that inverts the usual instinct, and it is why the app stops glowing at
  // night: chrome is the darkest plane, not the brightest.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    const block = themeBlock(css, scope);
    const paper = declaration(block, "--paper-solid")!;
    const canvas = declaration(block, "--canvas-solid")!;
    const sunk = declaration(block, "--bg-secondary")!;
    assert.ok(relativeLuminance(paper) > relativeLuminance(canvas),
      `${scope}: paper ${paper} must be lighter than canvas ${canvas}`);
    assert.ok(relativeLuminance(canvas) > relativeLuminance(sunk),
      `${scope}: canvas ${canvas} must be lighter than the sunk plane ${sunk}`);
    // Paper and canvas must also be the same declaration as the plane they
    // stand for, or the material cannot derive the ground from the palette.
    assert.equal(declaration(block, "--bg-reading"), paper, `${scope}: --bg-reading is paper`);
    assert.equal(declaration(block, "--bg-canvas"), canvas, `${scope}: --bg-canvas is canvas`);
  }
});

test("the material is a class over any atmosphere, never a theme of its own", () => {
  const css = read("src/renderer/styles.css");
  assert.doesNotMatch(css, /\.theme-glass|\.theme-dark-glass/);
  assert.doesNotMatch(css, /theme-preview-glass|theme-orb-glass/);

  const block = themeBlock(css, ".material-translucent");
  // Material applies to canvas, never to paper: the page has to stay opaque
  // or the text starts competing with whatever is behind the window.
  assert.ok(block.includes("--bg-canvas:"), "material must move the ground");
  assert.ok(!block.includes("--bg-reading:"), "material must never touch paper");
  assert.match(block, /--material-blur: 26px/);
});

test("an atmosphere sets tokens and nothing else", () => {
  // The generalisation of the two-accent rule. Deleting Porcelain's amber
  // stopped the accent from carrying theme identity, but a
  // `.theme-porcelain .some-component` rule would smuggle the same thing back
  // in through geometry or a one-off fill — and it would be invisible until
  // somebody opened that component in that one atmosphere. Ink is allowed
  // descendant rules under `.dark` because polarity is a real axis that
  // components must sometimes answer; temperature is not, so the two
  // temperature classes may only ever open a token block.
  for (const source of [STYLES, ...PARTIALS]) {
    const css = read(source);
    for (const scope of [".theme-porcelain", ".theme-onyx"]) {
      // The first lookahead keeps `.theme-preview-porcelain` and
      // `.theme-orb-porcelain` out of it — those are swatches that legitimately
      // paint an atmosphere they are not currently in. The second allows the
      // only two things that may follow the class: its own opening brace, and a
      // comma joining it to another scope in the same token block.
      const pattern = new RegExp(`\\${scope}(?![\\w-])(?!\\s*[{,])[^\\n]{0,48}`, "g");
      const offenders = css.match(pattern) ?? [];
      assert.deepEqual(offenders, [],
        `${source}: ${scope} may only open a token block, never style a descendant`);
    }
  }
});

test("focus is the seal in every atmosphere, at one alpha per polarity", () => {
  const css = read(STYLES);

  // Focus is authorship's own colour because focus is the app saying "this is
  // the thing you are about to write with". A focus ring tuned per theme would
  // be a fifth and sixth accent value arriving through the back door, so the
  // rule that governs the seal governs the ring: two values, chosen by
  // polarity, never by temperature.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    const block = themeBlock(css, scope);
    const seal = declaration(block, "--accent-seal")!;
    const ring = declaration(block, "--study-gold-focus")!;
    assert.equal(ring.slice(0, ring.lastIndexOf(",")), `rgba(${rgbChannels(seal).join(", ")}`,
      `${scope}: the focus ring is the seal's own channels, not a colour of its own`);
  }
  for (const [light, dark] of [[":root", ".theme-porcelain"], [".dark", ".theme-onyx"]] as const) {
    assert.equal(
      declaration(themeBlock(css, dark), "--study-gold-focus"),
      declaration(themeBlock(css, light), "--study-gold-focus"),
      `${dark} must carry ${light}'s focus ring: temperature does not change a ring`,
    );
  }
});

test("hover is a line in every atmosphere, never a fill", () => {
  const css = read(STYLES);

  // Reserve, and the mark language, meeting on the same token. A hover fill is
  // a third plane that exists for as long as the pointer is still, and it is
  // reliably the brightest thing on screen at the moment the reader is least
  // interested in it. So the hover surface is transparent in all four and the
  // feedback is a hairline.
  //
  // The line is not a colour of its own either: it is the atmosphere's own
  // primary ink at one alpha per polarity — .10 where the page is bright and
  // .14 where it is dark, because the same alpha reads fainter against a dark
  // ground. That is what keeps hover quieter than the text beside it in all
  // four without anybody having to pick four greys.
  for (const [scope, alpha] of [
    [":root", "0.10"], [".theme-porcelain", "0.10"],
    [".dark", "0.14"], [".theme-onyx", "0.14"],
  ] as const) {
    const block = themeBlock(css, scope);
    assert.equal(declaration(block, "--study-hover-surface"), "transparent",
      `${scope}: hover is a mark, never a fill`);
    const ink = declaration(block, "--text-primary")!;
    assert.equal(declaration(block, "--study-hover-line"),
      `rgba(${rgbChannels(ink).join(", ")}, ${alpha})`,
      `${scope}: the hover line is this atmosphere's own ink at ${alpha}`);
  }
});

test("the four atmospheres are the palette I·2 draws", () => {
  const css = read(STYLES);

  // Read straight off the study, which renders the same tab in all four:
  // paper, the ground it floats on, and the hairline that divides the header
  // from the verses. Ink's hairline is deliberately the faintest of the four —
  // that is drawn, not drifted, and the assertion exists so nobody "corrects"
  // it toward Paper's ratio later.
  for (const [scope, paper, canvas, hairline] of [
    [":root", "#FCFBF8", "#F1EFEA", "#E2DED6"],
    [".theme-porcelain", "#FFFFFF", "#F4F4F6", "#E4E4E8"],
    [".dark", "#1D1B18", "#141210", "#2A2723"],
    [".theme-onyx", "#1C1C20", "#131316", "#2C2C32"],
  ] as const) {
    const block = themeBlock(css, scope);
    assert.equal(declaration(block, "--paper-solid"), paper, `${scope}: paper`);
    assert.equal(declaration(block, "--canvas-solid"), canvas, `${scope}: canvas`);
    assert.equal(declaration(block, "--border-subtle"), hairline, `${scope}: hairline`);
    // Whatever sits on the seal is that atmosphere's own paper, so a sealed
    // chip reads as a piece of the page rather than as white applied to a
    // brown swatch — which is what it would look like in Porcelain and Onyx if
    // this were a literal.
    assert.equal(declaration(block, "--text-on-accent"), paper,
      `${scope}: text on the seal is this atmosphere's paper`);
  }
});

test("one tab shape in every atmosphere, because nothing in it is a colour", () => {
  const css = read(STYLES);

  // I·2's whole argument for testing the palette against the tab is that the
  // tab does not depend on the palette: it is paper pulled up above the
  // register's baseline, and its two fillets are the same paper with a corner
  // carved out. If any of the three ever takes a literal, the shape stops
  // fusing in whichever atmosphere the literal was not chosen for.
  const tab = ruleBlocks(css, '.scripture-workspace-tab[aria-selected="true"]').join("\n");
  assert.ok(tab.length > 0, "expected rules for the selected tab");
  assert.ok((tab.match(/var\(--bg-reading\)/g) ?? []).length >= 3,
    "the fill and both fillets are paper — three references, one per surface");
  assert.doesNotMatch(tab, /#[0-9A-Fa-f]{3,8}\b|\brgba?\(/,
    "the selected tab and its fillets must carry no literal colour");

  // And the joint is one radius in three places. If the tab, the fillet and the
  // page ever take different numbers the fillet stops reading as a joint and
  // starts reading as a rendering bug — which is exactly how it would look in
  // whichever atmosphere separates its two planes most weakly.
  assert.match(css, /--radius-page: 8px;/);
  assert.ok((tab.match(/var\(--radius-page\)/g) ?? []).length >= 4,
    "both fillets take the page radius for their size and their offset");
});

test("the destructive labels resolve through the palette, in all four", () => {
  const css = read(STYLES);
  const themes = read("src/renderer/styles/themes.css");

  // Both call sites read a token that the bundle never declared, so the
  // fallback hex was the colour that actually rendered — the same raw red in
  // every atmosphere, and 2.96:1 on Ink's paper. The names are now aliases of
  // the semantic error hue.
  assert.match(css, /var\(--text-danger, *#c0392b\)/i);
  assert.match(css, /var\(--danger, *#9f4d45\)/i);

  // The alias is repeated per scope on purpose: a custom property substitutes
  // its var() at the element that declares it, so an alias living only on
  // :root would freeze the root's --error and silently ignore a dark polarity
  // added later. If --error ever gains one, this test fails until the alias
  // follows it into the same scope.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    if (scope !== ":root") {
      assert.equal(declaration(themeBlock(css, scope), "--error"), null,
        `${scope} declares --error; the danger aliases must be re-checked against it`);
    }
    assert.ok(themes.includes(scope), `themes.css must alias the danger tokens in ${scope}`);
  }
  assert.match(themes, /--text-danger: var\(--error\);/);
  assert.match(themes, /--danger: var\(--error\);/);
});

test("the narrow shell's dynamic-type gutter is declared exactly once", () => {
  // H·2·4 steps the verse gutter from 24px to 32px at the largest reading
  // size. That step and the 24px it starts from are one decision, so they live
  // in one block. mobile.css used to carry a second identical copy that could
  // never fire — styles.css is imported after every partial and won the tie on
  // source order — and a rule that cannot fire is a rule nobody notices going
  // stale.
  assert.doesNotMatch(read("src/renderer/styles/mobile.css"), /--verse-gutter:/,
    "the gutter's narrow-shell values belong in one block, in styles.css");
  const narrow = narrowShellBlock(read(STYLES));
  assert.match(narrow, /--verse-gutter: 24px;/);
  assert.match(narrow, /\.reading-size-l \{\s*--verse-gutter: 32px;/);
});

test("the bottom bar's mark sits on the edge nearest the page", () => {
  // H names this as one of the three things that survive every width without
  // amendment: the mark is always on the edge facing the content it opens. In
  // the rail that is the left edge; once the rail is a bottom bar the page is
  // above it, so the same 2px seal moves to the top. It is the same rule, so
  // it must not be re-derived as a new one.
  const narrow = narrowShellBlock(read(STYLES));
  const mark = ruleBlocks(narrow, ".nav-item::before").join("\n");
  assert.match(mark, /inset: 0 0 auto 0;/, "the mark spans the top edge");
  assert.match(mark, /height: 2px;/, "it is the same 2px rule the rail uses");
});

test("Onyx reaches portals and every marking surface through isDarkTheme", () => {
  const surface = read("src/renderer/components/MarkingSurface.tsx");
  assert.doesNotMatch(surface, /theme === "dark" \|\| theme === "dark-glass"/);
  assert.ok((surface.match(/isDarkTheme\(theme\)/g) ?? []).length >= 1);
});

function themeBlock(css: string, scope: string): string {
  const start = css.indexOf(`${scope} {`);
  assert.notEqual(start, -1, `expected a ${scope} block`);
  return css.slice(start, css.indexOf("}", start));
}

function declaration(block: string, name: string): string | null {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

/** Every rule whose selector list mentions `needle`, body only, braces balanced. */
function ruleBlocks(css: string, needle: string): string[] {
  const found: string[] = [];
  for (let at = css.indexOf(needle); at !== -1; at = css.indexOf(needle, at + 1)) {
    const open = css.indexOf("{", at);
    // A comma before the brace means this is one selector of a group whose rule
    // starts elsewhere; the group is collected from its first selector instead.
    if (open === -1 || css.slice(at + needle.length, open).includes(",")) continue;
    found.push(balanced(css, open));
  }
  return found;
}

/** One rule or at-rule body, from its opening brace to the brace that closes it. */
function balanced(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/**
 * Every `@media (max-width: 979px)` body in one string. The narrow shell is
 * written as several blocks rather than one — the rail, the margin and the bar
 * each state their own concession next to the reason for it — so a test that
 * read only the first would silently stop covering the rest.
 */
function narrowShellBlock(css: string): string {
  const bodies: string[] = [];
  const marker = "@media (max-width: 979px)";
  for (let at = css.indexOf(marker); at !== -1; at = css.indexOf(marker, at + 1)) {
    bodies.push(balanced(css, css.indexOf("{", at)));
  }
  assert.notEqual(bodies.length, 0, "expected a narrow-shell media query");
  return bodies.join("\n");
}

/** The three channels of a #rrggbb, so a derived rgba() can be checked against it. */
function rgbChannels(hex: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(left: string, right: string): number {
  const high = Math.max(relativeLuminance(left), relativeLuminance(right));
  const low = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (high + 0.05) / (low + 0.05);
}
