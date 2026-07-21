import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const siteRoot = resolve(root, "site");
const html = readFileSync(resolve(siteRoot, "index.html"), "utf8");
const script = readFileSync(resolve(siteRoot, "script.js"), "utf8");
const css = readFileSync(resolve(siteRoot, "styles.css"), "utf8");

test("standalone landing page has no missing local assets or internal targets", () => {
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1]!;
    if (target.startsWith("#")) {
      assert.match(html, new RegExp(`id=["']${escapeRegex(target.slice(1))}["']`), `missing ${target}`);
      continue;
    }
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    assert.equal(existsSync(resolve(dirname(resolve(siteRoot, "index.html")), target)), true, `missing ${target}`);
  }
});

test("landing page intentionally preserves four atmosphere previews and motion fallback", () => {
  assert.deepEqual(
    [...html.matchAll(/class="atmos-card[^"*]*" data-theme="([^"]+)"/g)].map((match) => match[1]),
    ["paper", "ink", "glass", "candlelight"],
  );
  assert.doesNotMatch(html, /data-theme="(?:porcelain|onyx)"/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /querySelectorAll\("\.atmos-card\[data-theme\]"\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
