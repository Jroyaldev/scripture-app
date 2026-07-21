import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("reviewed manifests and cards retain the common link-only permission boundary", () => {
  const sources = ["working-preacher", "bibleproject", "the-gospel-coalition"];
  for (const source of sources) {
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

test("permission review records current official sources and deferred capabilities", () => {
  const review = read("docs/trusted-resource-permissions.md");
  assert.match(review, /Reviewed: 2026-07-20/);
  assert.match(review, /workingpreacher\.org\/copyright/);
  assert.match(review, /bibleproject\.com\/terms/);
  assert.match(review, /thegospelcoalition\.org\/permissions/);
  assert.match(review, /automated full-catalog crawling/);
  assert.match(review, /background refresh or runtime network access/);
});
