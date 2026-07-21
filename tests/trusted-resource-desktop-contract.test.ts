import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("typed resource IPC is sender-bound, manifest-backed, and official-host allowlisted", () => {
  const main = read("src/electron/main.ts");
  const preload = read("src/electron/preload.ts");
  assert.match(main, /registerRuntimeReadIpc\("trusted-resources-query"/);
  assert.match(main, /validateTrustedResourceQuery/);
  assert.match(main, /loadTrustedResourceManifests/);
  assert.match(main, /registerRuntimeReadIpc\("trusted-resource-open"/);
  assert.match(main, /entry\.id === resourceId && entry\.officialUrl === requestedUrl/);
  assert.match(main, /ALLOWED_TRUSTED_RESOURCE_HOSTS/);
  assert.match(preload, /trustedResources:[\s\S]*trusted-resources-query[\s\S]*trusted-resource-open/);
});

test("Living Margin exposes one featured and at most two compact link-only cards", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const start = margin.indexOf("function TrustedResourcesBlock");
  const end = margin.indexOf("function DeepNoteCard", start);
  const block = margin.slice(start, end);
  assert.match(block, /Trusted resources/);
  assert.match(block, /resources\.slice\(0, 3\)/);
  assert.match(block, /index === 0 \? " is-featured" : " is-compact"/);
  assert.match(block, /openOfficial/);
  assert.doesNotMatch(block, />Save/);
  assert.doesNotMatch(block, /<img|artwork|embed|description/);
});
