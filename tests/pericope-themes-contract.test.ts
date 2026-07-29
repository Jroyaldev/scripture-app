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

/**
 * The paper each atmosphere measures its own ink against. Law 6 is a statement
 * about a token *on its own ground*, so there is no global answer: the same
 * seal is 4.64:1 on Paper and 6.82:1 in Ink.
 */
const PAPER = {
  ":root": "#FCFBF8",
  ".dark": "#1D1B18",
  ".theme-porcelain": "#FFFFFF",
  ".theme-onyx": "#1C1C20",
} as const;

/**
 * Law 6's three floors, assigned once per token rather than argued at each
 * call site.
 *
 *   4.5 — ink that carries meaning, AT EVERY SIZE. This language has no
 *         large-text exemption, because its chrome sets at 8–10px.
 *   3   — a mark that carries meaning without words.
 *   0   — is not a floor and is not offered here. A token that would "lose
 *         nothing if deleted" still has to say so in the sheet; see below.
 *
 * `onSeal` marks the one token whose ground is not paper: --text-on-accent is
 * whatever sits on the seal, so measuring it against paper would score a
 * legible chip as a failure and an illegible one as a pass.
 */
const LAW6: Record<string, { floor: number; onSeal?: true }> = {
  "--text-primary": { floor: 4.5 },
  "--text-secondary": { floor: 4.5 },
  "--text-tertiary": { floor: 4.5 },
  "--text-verse-number": { floor: 4.5 },
  "--text-link": { floor: 4.5 },
  "--text-link-hover": { floor: 4.5 },
  "--text-on-accent": { floor: 4.5, onSeal: true },
  "--accent-seal": { floor: 4.5 },
  "--accent-seal-strong": { floor: 4.5 },
  "--accent-machine": { floor: 4.5 },
  "--accent-laurel": { floor: 4.5 },
  "--accent-warm": { floor: 4.5 },
  "--accent-warm-light": { floor: 4.5 },
  "--accent-user": { floor: 4.5 },
  "--accent-source": { floor: 4.5 },
  "--accent-ai": { floor: 4.5 },
  "--accent-xref": { floor: 4.5 },
  "--accent-current": { floor: 4.5 },
  "--study-gold": { floor: 4.5 },
  // Usually drawn as a mark rather than words, so 3:1 is the operative floor;
  // where they set text — a failed job's status line, a discard label — 4.5:1
  // is. All three clear the higher of the two in all four atmospheres, so the
  // higher one is what is asserted and the distinction never has to be
  // adjudicated per call site.
  "--healthy": { floor: 4.5 },
  "--warning": { floor: 4.5 },
  "--error": { floor: 4.5 },
  // Rules. §4 marks the hairline "exempt, separates only"; the other two are
  // the same object at two weights. They are given the mark floor rather than
  // no floor, so that the exemption has to be *written* rather than assumed.
  "--border-subtle": { floor: 3 },
  "--border-medium": { floor: 3 },
  "--border-strong": { floor: 3 },
};

test("Law 6 · every ink states its ratio, and the ratio it states is true", () => {
  const css = read(STYLES);

  // The novel half of Law 6, and the reason it is a law rather than a habit:
  // "Every token states its ratio in the token file as a comment; an unstated
  // ratio is a defect." A comment is only worth writing if it cannot go stale,
  // so this recomputes each one from the declared hex and the atmosphere's own
  // paper and requires the sheet's own number to match. A token that fails its
  // floor is allowed through only by an explicit written excuse — `exempt:`
  // with a reason, or a `@quire trigger` saying the palette has no value to
  // move it to. What is forbidden is silence.
  let checked = 0;
  for (const [scope, paper] of Object.entries(PAPER)) {
    const block = themeBlock(css, scope);
    const declared = inkDeclarations(block);
    const seal = declared.get("--accent-seal")?.value;
    assert.ok(seal, `${scope} must declare --accent-seal`);

    for (const [name, rule] of Object.entries(LAW6)) {
      const decl = declared.get(name);
      assert.ok(decl, `${scope} must declare ${name}`);
      const ground = rule.onSeal ? seal : paper;
      const actual = contrastRatio(decl.value, ground);

      const stated = decl.comment.match(/(\d+(?:\.\d+)?):1/);
      assert.ok(stated,
        `${scope}: ${name} states no ratio — Law 6 calls an unstated ratio a defect`);
      assert.ok(Math.abs(Number(stated[1]) - actual) < 0.006,
        `${scope}: ${name} states ${stated[1]}:1 but ${decl.value} on ${ground} measures ` +
        `${actual.toFixed(3)}:1 — a wrong ratio is worse than none, because it is trusted`);

      if (actual >= rule.floor) {
        checked += 1;
        continue;
      }
      assert.match(decl.comment, /(?:^|·\s*)exempt:\s*\S|@quire trigger/,
        `${scope}: ${name} is ${actual.toFixed(2)}:1, under its ${rule.floor}:1 floor, and says ` +
        `nothing about why — write "exempt: <reason>" or mark it "@quire trigger"`);
      checked += 1;
    }
  }
  assert.equal(checked, Object.keys(LAW6).length * 4);
});

test("Law 6 · a new ink cannot enter an atmosphere without stating its ratio", () => {
  const css = read(STYLES);

  // The generalisation. The table above is a list, and a list is only as good
  // as the thing that stops people adding around it: without this, a
  // `--accent-whatever` added next month would be measured by nobody, which is
  // precisely how the palette accumulated a 2.44:1 warning and a 3.22:1 ink-3
  // in the first place. Every --text-* and --accent-* the four blocks declare
  // must appear in LAW6, and every entry in LAW6 must be declared in all four
  // — so the two lists cannot drift, in either direction.
  for (const scope of Object.keys(PAPER)) {
    const inks = [...inkDeclarations(themeBlock(css, scope)).keys()]
      .filter((name) => name.startsWith("--text-") || name.startsWith("--accent-"))
      .sort();
    const governed = Object.keys(LAW6)
      .filter((name) => name.startsWith("--text-") || name.startsWith("--accent-"))
      .sort();
    assert.deepEqual(inks, governed,
      `${scope}: every ink in an atmosphere is governed by Law 6, and nothing else is`);
  }
});

test("Law 6 · the exemptions are the ones the palette actually licenses", () => {
  const css = read(STYLES);

  // An exemption that nobody re-reads becomes a way to opt out of the law, so
  // the set of tokens claiming one is pinned. Two kinds are licensed here and
  // they are not the same kind of thing:
  //
  //   exempt — §4's own word for the hairline, "exempt, separates only": it
  //            carries no meaning a reader could lose. --accent-warm and
  //            --accent-warm-light join it on the law's other clause, "no
  //            floor for fills that would lose nothing if deleted" — they have
  //            zero var() references in the bundle, so deleting them would
  //            lose exactly nothing. They are reported for removal.
  //
  //   trigger — NOT an exemption. --text-verse-number is text, at 9–10px, at
  //            2.13–2.30:1, and §4 has no row to move it to: its faintest ink
  //            is ink-faint, marked "non-text only". §9's first trigger is
  //            "you need a colour that is not in the palette", answered the
  //            same week and never batched. It is marked rather than restyled
  //            because choosing the value is the designer's decision, not this
  //            block's — but it may not pass quietly while it waits.
  const excused = { exempt: new Set<string>(), trigger: new Set<string>() };
  for (const scope of Object.keys(PAPER)) {
    for (const [name, decl] of inkDeclarations(themeBlock(css, scope))) {
      if (!(name in LAW6)) continue;
      if (/(?:^|·\s*)exempt:\s*\S/.test(decl.comment)) excused.exempt.add(name);
      if (decl.comment.includes("@quire trigger")) excused.trigger.add(name);
    }
  }
  assert.deepEqual([...excused.exempt].sort(), [
    "--accent-warm", "--accent-warm-light",
    "--border-medium", "--border-strong", "--border-subtle",
  ]);
  assert.deepEqual([...excused.trigger].sort(), ["--text-verse-number"]);
});

test("the semantic hues carry their polarity into the token artifact too", () => {
  const css = read(STYLES);
  const tokens = JSON.parse(read("src/renderer/design-tokens.json")) as {
    status: Record<string, string>;
    semantic: Record<string, Record<string, string>>;
  };

  // design-tokens.json is a hand-maintained mirror, and the consolidation
  // contract that checks it reads `status` as a flat :root-only table — which
  // is exactly the shape that lost the polarity in the first place. So the
  // artifact keeps `status` for that reader and gains `semantic` per scope for
  // this one, and both are checked, or the mirror gains a blind spot precisely
  // where the defect was.
  for (const [scope, table] of Object.entries(tokens.semantic)) {
    if (scope.startsWith("$")) continue;
    const block = themeBlock(css, scope);
    for (const [name, value] of Object.entries(table)) {
      assert.equal(declaration(block, name), value,
        `${scope} { ${name} } drifted between styles.css and design-tokens.json`);
    }
  }
  assert.deepEqual(tokens.status, tokens.semantic[":root"],
    "the flat status table is the light polarity under its old name");

  // Polarity, stated as the thing it is: the two light atmospheres share a set
  // and the two dark ones share a different set, and the two sets differ.
  for (const name of ["--healthy", "--warning", "--error"] as const) {
    assert.equal(tokens.semantic[".theme-porcelain"]![name], tokens.semantic[":root"]![name]);
    assert.equal(tokens.semantic[".theme-onyx"]![name], tokens.semantic[".dark"]![name]);
    assert.notEqual(tokens.semantic[".dark"]![name], tokens.semantic[":root"]![name],
      `${name} without a polarity is the defect Rev 04 §4 corrected`);
  }
});

test("laurel is declared in every atmosphere, at two values and not four", () => {
  const css = read(STYLES);

  // Law 3 gained a third ink: "Laurel — a named third party wrote it and we
  // licensed it." Declaring it is all that happens here. Migrating the TIPNR
  // and Pleiades strings onto it is ruling 4·5's own pass over the margin and
  // entity rules, which this block does not own.
  //
  // It arrives under the rule the seal and the machine hue already live by:
  // two values chosen by polarity, never four chosen by temperature. A laurel
  // tuned "to Porcelain's temperature" would be the amber mistake a third
  // time, and the ink would start saying which theme you are in rather than
  // who wrote the sentence.
  for (const [light, dark] of [[":root", ".dark"], [".theme-porcelain", ".theme-onyx"]] as const) {
    assert.equal(declaration(themeBlock(css, light), "--accent-laurel"), "#5F6B52");
    assert.equal(declaration(themeBlock(css, dark), "--accent-laurel"), "#9DAA8A");
  }

  // And it is genuinely a third ink, not a renaming of one of the two. If
  // laurel ever collided with seal or slate, "we licensed this" and "you wrote
  // this" would become the same claim on screen.
  for (const scope of Object.keys(PAPER)) {
    const block = themeBlock(css, scope);
    const laurel = declaration(block, "--accent-laurel")!;
    assert.notEqual(laurel, declaration(block, "--accent-seal"));
    assert.notEqual(laurel, declaration(block, "--accent-machine"));
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
    assert.ok(relativeLuminance(paper) > relativeLuminance(canvas),
      `${scope}: paper ${paper} must be lighter than canvas ${canvas}`);
    // Paper and canvas must also be the same declaration as the plane they
    // stand for, or the material cannot derive the ground from the palette.
    assert.equal(declaration(block, "--bg-reading"), paper, `${scope}: --bg-reading is paper`);
    assert.equal(declaration(block, "--bg-canvas"), canvas, `${scope}: --bg-canvas is canvas`);
  }
});

test("the sunk plane is retired: there is no third fill left to paint with", () => {
  const css = read("src/renderer/styles.css");

  // This assertion used to say the opposite. It required
  // `luminance(canvas) > luminance(sunk)` — that is, it required a THIRD plane
  // to exist and to be correctly ordered beneath the ground, which is Law 1
  // read as "two planes and a basement". Rev 04 §4 lists paper, canvas,
  // hairline and the inks and nothing else, and the value it now calls canvas
  // (#E9E6E0) is the value this sheet used to call sunk. So the third plane is
  // not merely discouraged, it is absent from the palette.
  //
  // --bg-secondary is not deleted here: ~83 rules read it, none of them owned
  // by this block, and deleting the token would break all of them in a pass
  // that is meant to be visually neutral. It is pinned to the ground instead,
  // so it can no longer paint a plane of its own no matter who reads it, and
  // the removal becomes one scheduled sweep rather than 83 breakages.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    const block = themeBlock(css, scope);
    const canvas = declaration(block, "--canvas-solid")!;
    assert.equal(declaration(block, "--bg-secondary"), canvas,
      `${scope}: the sunk plane is retired, so --bg-secondary must be the ground itself`);
    assert.match(block, /--bg-secondary: [^;]+;\/\* = --bg-canvas; awaiting removal \*\//,
      `${scope}: --bg-secondary must record that it is retired, or it reads as a live third plane`);
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
      // `.theme-swatch-porcelain` out of it — those are swatches that
      // legitimately paint an atmosphere they are not currently in. (It also
      // used to name `.theme-orb-porcelain`, which no longer exists: the orb
      // sits inside the atmosphere it names and so paints none.) The second
      // allows the
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
  // Paper's ground is Rev 04 §4's, not I·2's: #F1EFEA moved down to #E9E6E0
  // when the sunk plane was withdrawn and its value became the ground. The
  // other three grounds are unchanged — §4 gives one ground for the warm light
  // atmosphere and none for the rest, and Law 6 asks nothing of a fill.
  for (const [scope, paper, canvas, hairline] of [
    [":root", "#FCFBF8", "#E9E6E0", "#E2DED6"],
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
  // One value in three places is the claim; the literal never was. It read 8px
  // until the frame was re-canonned on 2026-07-29 and became 14, so this
  // asserts the shape of the declaration rather than its magnitude — the number
  // belongs to the frame table, and pinning it here made this file a second
  // owner of a decision it does not own.
  const pageRadius = [...css.matchAll(/--radius-page:\s*([^;]+);/g)];
  assert.equal(pageRadius.length, 1, "--radius-page is declared once");
  assert.match(pageRadius[0]![1]!.trim(), /^\d+px$/);
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
  // added later. That "later" is now — Rev 04 §4 gave the semantic hues a
  // polarity — so the guard flips from "no scope may declare --error yet" to
  // "every scope declares one, and the alias is present in each of them to
  // re-resolve against it". Had the alias lived only on :root, Ink and Onyx
  // would have gone on rendering the light red on a dark ground: 3.24:1, the
  // exact failure the polarity exists to prevent.
  for (const scope of [":root", ".dark", ".theme-porcelain", ".theme-onyx"]) {
    assert.ok(declaration(themeBlock(css, scope), "--error"),
      `${scope} must declare --error, or the danger aliases resolve to another atmosphere's red`);
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
  // the rail that is the RIGHT edge — Rev 05 §05·3 revised Study A there, since
  // the rail opens the page and B·2's inset put the page unambiguously to the
  // rail's right — and once the rail is a bottom bar the page is above it, so
  // the same 2px seal moves to the top. One rule, three shells; it must not be
  // re-derived as a new one at any of them. (The 2px below is now literally the
  // rail's own number as well: §05·3 took the rail's reserve from 3 to 2, which
  // is what this comment always claimed it was.)
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

/**
 * Every declaration in a token block that names a literal colour, paired with
 * the comment on its own line. Law 6 puts the ratio *beside* the value on
 * purpose — a ratio in a paragraph above drifts silently when one line in the
 * group changes — so the comment is read from the same line and nowhere else.
 */
function inkDeclarations(block: string): Map<string, { value: string; comment: string }> {
  const found = new Map<string, { value: string; comment: string }>();
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*(--[\w-]+):\s*(#[0-9A-Fa-f]{6});\s*(?:\/\*(.*?)\*\/)?/);
    if (!match) continue;
    found.set(match[1]!, { value: match[2]!, comment: (match[3] ?? "").trim() });
  }
  return found;
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
