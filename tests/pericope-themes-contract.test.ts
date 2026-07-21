import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isDarkTheme, THEME_OPTIONS } from "../src/renderer/theme.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("Pericope exposes six stable atmospheres and treats Onyx as dark", () => {
  assert.deepEqual(THEME_OPTIONS.map((option) => option.id), [
    "porcelain", "light", "dark", "onyx", "glass", "dark-glass",
  ]);
  assert.equal(isDarkTheme("onyx"), true);
  assert.equal(isDarkTheme("porcelain"), false);
  assert.equal(isDarkTheme("dark-glass"), true);
});

test("Porcelain separates bright fill gold from AA non-text stroke gold", () => {
  const css = read("src/renderer/styles.css");
  const block = css.slice(css.indexOf(".theme-porcelain"), css.indexOf(".theme-onyx"));
  assert.match(block, /--accent-current:\s*#E8A33D/);
  assert.match(block, /--study-gold:\s*#B87D1C/);
  assert.ok(contrastRatio("#B87D1C", "#FFFFFF") >= 3);
  assert.match(css, /\.connection-kind-parallel\s*\{\s*--connection-ink:\s*var\(--mark-parallel\)/);
});

test("Onyx reaches portals and all four marking surfaces through isDarkTheme", () => {
  const surface = read("src/renderer/components/MarkingSurface.tsx");
  const main = read("src/electron/main.ts");
  const qa = read("scripts/qa-theme-tour.mjs");
  assert.equal((surface.match(/isDarkTheme\(theme\)/g) ?? []).length, 4);
  assert.doesNotMatch(surface, /theme === "dark" \|\| theme === "dark-glass"/);
  assert.match(main, /function normalizeTheme/);
  assert.match(main, /theme:\s*normalizeTheme\(partial\.theme \?\? store\.store\.theme\)/);
  for (const id of ["porcelain", "light", "dark", "onyx", "glass", "dark-glass"]) {
    assert.ok(qa.includes(`"${id}"`));
  }
});

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
