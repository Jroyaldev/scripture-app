import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isDarkTheme, migrateLegacyTheme, THEME_OPTIONS } from "../src/renderer/theme.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

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

  // The seal must clear 3:1 against its own paper, so a 2px mark is legible.
  for (const [scope, paper] of [
    [":root", "#FCFBF8"], [".theme-porcelain", "#FFFFFF"],
  ] as const) {
    const seal = declaration(themeBlock(css, scope), "--accent-seal")!;
    assert.ok(contrastRatio(seal, paper) >= 3,
      `${scope}: seal ${seal} on ${paper} is ${contrastRatio(seal, paper).toFixed(2)}:1, needs 3:1`);
  }

  assert.match(css, /\.connection-kind-parallel\s*\{\s*--connection-ink:\s*var\(--mark-parallel\)/);
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

function contrastRatio(left: string, right: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const high = Math.max(luminance(left), luminance(right));
  const low = Math.min(luminance(left), luminance(right));
  return (high + 0.05) / (low + 0.05);
}
