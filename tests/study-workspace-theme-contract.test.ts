import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const styles = readFileSync(resolve(import.meta.dirname, "../src/renderer/styles.css"), "utf8");
const workspaceStart = styles.indexOf(".scripture-workspace-bar {");
const workspaceEnd = styles.indexOf(".topbar-navigation,", workspaceStart);
const workspaceStyles = styles.slice(workspaceStart, workspaceEnd);

test("all six themes derive the study rail from the toolbar token and keep their active plate", () => {
  // The rail surface is a single derivative of --bg-topbar in every theme, so
  // the two read as one continuous chrome; only the active plate stays bespoke.
  for (const active of [
    "#FCF8EF",
    "#1D1915",
    "#FFF9F0",
    "#2D251F",
    "#FFFFFF",
    "#232326",
  ] as const) {
    assert.match(styles, new RegExp(
      "--workspace-bar-bg: color-mix\\(in srgb, rgb\\(from var\\(--bg-topbar\\) r g b \\/ 1\\) 96%, #000\\);[\\s\\S]{0,120}"
      + `--workspace-active-bg: ${active.replace(/[().]/g, "\\$&")};`,
    ));
  }
  assert.equal(
    [...styles.matchAll(/--workspace-bar-bg: color-mix\(in srgb, rgb\(from var\(--bg-topbar\) r g b \/ 1\) 96%, #000\);/g)].length,
    6,
  );
  assert.match(workspaceStyles, /\.scripture-workspace-bar \{[\s\S]{0,420}background: var\(--workspace-bar-bg\)/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab\[aria-selected="true"\] \{[\s\S]{0,160}background: var\(--workspace-active-bg\)/);
});

test("workspace labels and controls stay readable without nested alpha masks", () => {
  // The only mask in the block is the clean scroll-edge fade on the viewport;
  // labels and marks never rely on alpha masks.
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-tab-label \{[\s\S]{0,180}mask-image/);
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-tab\.is-scripture::before/);
  assert.doesNotMatch(
    workspaceStyles.slice(
      workspaceStyles.indexOf(".scripture-workspace-actions"),
      workspaceStyles.indexOf(".scripture-workspace-overflow-head"),
    ),
    /linear-gradient/,
  );
  assert.match(workspaceStyles, /font-size: 12px/);
  // Gold indicator on selection; neutral text elsewhere.
  assert.match(workspaceStyles, /\.scripture-workspace-tab\[aria-selected="true"\]::after \{[\s\S]{0,240}background: var\(--study-gold\)/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-mark \{[\s\S]{0,180}opacity: 1/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-wrap\.is-selected \.scripture-workspace-tab-close \{ opacity: 1; \}/);
  // Scroll-edge indicators are clean mask fades, not blurred inset shadows.
  assert.match(workspaceStyles, /\.scripture-workspace-viewport\.is-scrollable-left\.is-scrollable-right \{[\s\S]{0,220}mask-image: linear-gradient/);
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-viewport\.is-scrollable-left\.is-scrollable-right \{[\s\S]{0,180}box-shadow:/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-close \{[\s\S]{0,180}min-width: 24px;[\s\S]{0,80}min-height: 24px;/);
  assert.match(workspaceStyles, /outline: 2px solid var\(--study-gold\);[\s\S]{0,60}outline-offset: 2px/);
  assert.doesNotMatch(
    workspaceStyles.slice(
      workspaceStyles.indexOf(".scripture-workspace-tab:focus-visible"),
      workspaceStyles.indexOf(".scripture-workspace-group"),
    ),
    /--study-gold-focus/,
  );
});

test("forced colors, reduced motion, and desktop zoom keep the strip operable", () => {
  assert.match(workspaceStyles, /@media \(forced-colors: active\)[\s\S]*background: Highlight; color: HighlightText/);
  assert.match(workspaceStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  assert.match(styles, /@media \(max-width: 760px\) and \(hover: none\) and \(pointer: coarse\) and \(any-hover: none\) \{\s*\.scripture-workspace-bar \{ display: none; \}/);
  const compactWidthBlock = styles.slice(
    styles.indexOf("@media (max-width: 760px) {"),
    styles.indexOf("/* Do not mistake desktop zoom for a phone."),
  );
  assert.doesNotMatch(compactWidthBlock, /\.scripture-workspace-bar \{ display: none; \}/);
});
