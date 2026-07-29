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

test("Living Margin shows a publisher's whole answer, and still only links to it", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const start = margin.indexOf("function TrustedResourcesBlock");
  const end = margin.indexOf("function DeepNoteCard", start);
  const block = margin.slice(start, end);
  /* "Trusted" read as an endorsement of what a publisher teaches. What was
     reviewed is the index — which sources may appear and what may be shown of
     them — not the content. The heading says so now. */
  assert.match(block, /Published resources/);

  /* The block used to render `resources.slice(0, 3)` — one featured card and two
     compact ones — so a publisher holding four good answers showed one and threw
     three away silently, and two publishers filled the margin before a third was
     ever consulted. A chip is now a publisher, and opening it shows everything
     that publisher has for the passage in the ranking's own order. Re-introducing
     a cap here is what this guards: an answer dropped without saying so reads as
     an answer that does not exist. */
  assert.doesNotMatch(block, /resources\.slice\(0,\s*\d/,
    "the margin caps the cards it will show, which hides answers without saying so");
  assert.match(block, /setOpenedSource/, "a publisher chip must open that publisher");
  assert.match(block, /groups\.map/, "opened publishers render every card they matched");

  /* The permission boundary is unchanged and does not move with the layout:
     the card links out, it does not reproduce. Audio is the one grant on top,
     and it is held to a press — see trusted-resource-permissions. */
  assert.match(block, /openOfficial/);
  assert.doesNotMatch(block, />Save/);
  assert.doesNotMatch(block, /<img|artwork|embed|description/);

  /* The element itself is no longer here. It was, and being here is what killed
     it: the block unmounts on every study tab, passage and panel close, so an
     episode lasted exactly as long as a reader stayed put. The transport moved
     to the app shell — components/PodcastPlayer — and the card now only presses
     play on it. So the guard moves with the element rather than lapsing: what
     it protects is that nothing is fetched from a publisher before a reader
     asks, and that is a property of wherever the element actually is. */
  assert.doesNotMatch(block, /<audio/,
    "the margin must not own an audio element again — it cannot keep one alive");
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /<audio/, "the transport must be exactly where the guard below looks");
  assert.match(player, /preload="none"/, "audio must not be fetched before a reader presses play");
  assert.doesNotMatch(player, /autoPlay|<img|<iframe|<video/);
});
