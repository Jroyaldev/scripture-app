import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/** Approved for their official marks. No other source is. */
const APPROVED_MARK_SOURCES = ["working-preacher", "bibleproject", "the-gospel-coalition"];
/** Approved 2026-07-27, and shipping without a bundled sample manifest. */
const APPROVED_MARK_SOURCES_IMPORTED = ["enter-the-bible", "naked-bible"];
const ALL_APPROVED_MARK_SOURCES = [...APPROVED_MARK_SOURCES, ...APPROVED_MARK_SOURCES_IMPORTED];

test("reviewed manifests and cards retain the common link-only permission boundary", () => {
  for (const source of APPROVED_MARK_SOURCES) {
    const manifest = read(`data/resources/${source}/manifest.json`);
    assert.match(manifest, /"permissions": "outbound-link-only"/);
    assert.match(manifest, /"capabilities": \["outbound-link"\]/);
    assert.doesNotMatch(manifest, /"(?:body|description|excerpt|artworkUrl|logoUrl|embedUrl|mediaUrl)"/);
  }

  const margin = read("src/renderer/components/LivingMargin.tsx");
  const start = margin.indexOf("function TrustedResourcesBlock");
  const end = margin.indexOf("function DeepNoteCard", start);
  const block = margin.slice(start, end);
  assert.match(block, /openOfficial/);
  assert.doesNotMatch(block, /<img|<iframe|<video|<audio|fetch\(|>Save/);
});

/**
 * The mark boundary is per source, so the thing worth guarding is not whether
 * marks exist but whether an unapproved source could inherit one. It cannot,
 * as long as every mark is attached by a rule that names its own source and
 * the default stays empty.
 */
test("official marks ship only for approved sources, from bundled local assets", () => {
  const css = read("src/renderer/styles.css");
  const markRules = css.match(/--resource-mark:\s*url\("[^"]+"\)/g) ?? [];
  assert.equal(markRules.length, ALL_APPROVED_MARK_SOURCES.length);

  for (const rule of markRules) {
    const url = /url\("([^"]+)"\)/.exec(rule)?.[1] ?? "";
    assert.match(url, /^\.\/assets\/brand\//, "a mark must be a bundled local asset, never a publisher URL");
    assert.ok(existsSync(resolve(root, "src/renderer", url)), `missing bundled mark: ${url}`);
  }

  for (const source of ALL_APPROVED_MARK_SOURCES) {
    const declaration = new RegExp(
      String.raw`\.trusted-resource-card\[data-source="${source}"\][^}]*--resource-mark:\s*url\(`,
    );
    assert.match(css, declaration, `${source} must declare its own mark`);
  }

  assert.match(css, /--resource-mark:\s*none;/, "the default must carry no mark");
});

test("permission review records the mark approval, its date, and its limits", () => {
  const review = read("docs/trusted-resource-permissions.md");
  assert.match(review, /Mark approval recorded: 2026-07-26/);
  assert.match(review, /2026-07-27 \(Enter the Bible, Naked Bible\)/);
  assert.match(review, /Approval is per source/);
  for (const source of ["Working Preacher", "BibleProject", "The Gospel Coalition", "Enter the Bible", "Naked Bible Podcast"]) {
    assert.match(review, new RegExp(String.raw`\| ${source} \|`));
  }
  assert.match(review, /marks for any source beyond those approved above/);
});

test("permission review records current official sources and deferred capabilities", () => {
  const review = read("docs/trusted-resource-permissions.md");
  assert.match(review, /Reviewed: 2026-07-20/);
  assert.match(review, /workingpreacher\.org\/copyright/);
  assert.match(review, /bibleproject\.com\/terms/);
  assert.match(review, /thegospelcoalition\.org\/permissions/);
  assert.match(review, /automated full-catalog crawling/);
  assert.match(review, /background refresh or runtime network access/);
});
