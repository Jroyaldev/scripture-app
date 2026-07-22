import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const styles = readFileSync(resolve(import.meta.dirname, "../src/renderer/styles.css"), "utf8");
const workspaceStart = styles.indexOf(".scripture-workspace-bar {");
const workspaceEnd = styles.indexOf(".topbar-navigation,", workspaceStart);
const workspaceStyles = styles.slice(workspaceStart, workspaceEnd);

test("all six themes resolve a stable study rail and active plate", () => {
  for (const pair of [
    ["#F7F1E6", "#FCF8EF"],
    ["#13110E", "#1D1915"],
    ["#F7F0E6", "#FFF9F0"],
    ["#1B1714", "#2D251F"],
    ["#F7F7F9", "#FFFFFF"],
    ["#18181B", "#232326"],
  ] as const) {
    assert.match(styles, new RegExp(
      `--workspace-bar-bg: ${pair[0].replace(/[().]/g, "\\$&")};[\\s\\S]{0,120}`
      + `--workspace-active-bg: ${pair[1].replace(/[().]/g, "\\$&")};`,
    ));
  }
  assert.match(workspaceStyles, /\.scripture-workspace-bar \{[\s\S]{0,420}background: var\(--workspace-bar-bg\)/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab\[aria-selected="true"\] \{[\s\S]{0,160}background: var\(--workspace-active-bg\)/);
});

test("workspace labels and controls stay readable without nested alpha masks", () => {
  assert.doesNotMatch(workspaceStyles, /mask-image/);
  assert.doesNotMatch(workspaceStyles, /\.scripture-workspace-tab\.is-scripture::before/);
  assert.doesNotMatch(
    workspaceStyles.slice(
      workspaceStyles.indexOf(".scripture-workspace-actions"),
      workspaceStyles.indexOf(".scripture-workspace-overflow-head"),
    ),
    /linear-gradient/,
  );
  assert.match(workspaceStyles, /font-size: 12px/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab\[aria-selected="true"\]::after \{[\s\S]{0,240}background: var\(--text-secondary\)/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-mark \{[\s\S]{0,180}opacity: 1/);
  assert.match(workspaceStyles, /\.scripture-workspace-tab-wrap\.is-selected \.scripture-workspace-tab-close \{ opacity: 1; \}/);
  assert.match(workspaceStyles, /\.scripture-workspace-viewport\.is-scrollable-left\.is-scrollable-right \{[\s\S]{0,180}box-shadow:/);
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
