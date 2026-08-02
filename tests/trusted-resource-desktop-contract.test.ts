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

test("the Resources room shows a publisher's whole answer, and still only links to it", () => {
  /* RESTATED 2026-07-30 · the block became a room.
     This read `TrustedResourcesBlock` out of LivingMargin — the publisher index
     that stood at the foot of the Overview tab. That block is gone and its work
     is in components/Resources, the study panel's fifth lens: one room, one
     card geometry, one identity key, holding the chapter's episodes AND its
     link-only material together. What this test protects is unchanged and moves
     with the work: a publisher's whole answer is shown, and the app still only
     links to it. */
  const room = read("src/renderer/components/Resources.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");

  /* "Trusted" read as an endorsement of what a publisher teaches. What was
     reviewed is the index — which sources may appear and what may be shown of
     them — not the content. Neither the lens nor the room says "trusted" to a
     reader anywhere. */
  assert.match(margin, /\{ id: "resources", label: "Resources", accessibleLabel: "Resources for this passage" \}/);
  assert.doesNotMatch(room, />\s*Trusted/);

  /* The block used to render `resources.slice(0, 3)` — one featured card and two
     compact ones — so a publisher holding four good answers showed one and threw
     three away silently. The room caps nothing: every entry it holds is drawn,
     which is what `content-visibility` in the stylesheet is for. The ONE cap in
     this file is the Overview digest, and it has a door beside it. */
  assert.doesNotMatch(room, /entries\.slice\(0,\s*\d/,
    "the room caps the cards it will show, which hides answers without saying so");
  assert.match(room, /shown\.map\(\(entry\) =>/, "the room draws everything it holds");
  assert.match(room, /entries\.slice\(0, DIGEST\)/);
  assert.match(room, /className="resources-door"/,
    "a digest without a door is a cap that hides answers");
  assert.match(room, /setOnly\(only === chip\.id \? null : chip\.id\)/,
    "a publisher chip must narrow the room to that publisher");

  /* The permission boundary is unchanged and does not move with the layout:
     the card links out, it does not reproduce. Audio is the one grant on top,
     and it is held to a press — see trusted-resource-permissions. */
  assert.match(room, /openOfficial/);
  assert.doesNotMatch(room, />Save/);
  /* Sharpened 2026-07-30, and narrowed to what it was always about. It read
     `/<img|artwork|embed|description/` — four bare words against a whole file,
     which caught this room's own comment about the app's embedding index. What
     the boundary forbids is REPRODUCING a publisher's material: their images,
     their prose, their players. It is markup and field names that say that. */
  assert.doesNotMatch(
    room,
    /<iframe\b|<video\b|dangerouslySetInnerHTML|record\.(?:description|excerpt|body|artworkUrl|logoUrl|embedUrl|mediaUrl)/,
    "the room may name a publisher's material and link to it; it may not reproduce it",
  );
  /* ── THE SHELF'S COVER FACE · 2026-08-02 ─────────────────────────────────
     Restated with the maintainer's authorisation, and the restatement carries
     the cost rather than dropping it.

     A cover on the shelf is NOT the same bargain the dock's sleeve is. The
     dock does not exist until an episode does, so its artwork is fetched from
     a host already streaming the listener audio. The shelf draws when a
     PASSAGE opens — so with covers on, opening Romans 8 tells eleven
     publishers' servers that this reader opened Romans 8. That is real, and it
     is the reason this face is a choice and not a change.

     So the contract becomes the DEFAULT rather than the absence: exactly one
     image in the room, drawn only when the reader has turned covers on, and
     the shipped face is the packaged mark, which fetches nothing. The store's
     own default is asserted here too, because that default IS the privacy
     property — a later edit flipping it would otherwise pass every gate.

     Still forbidden, unchanged: reproducing a publisher's prose, their
     players, or any field of their record beyond what a card names and links. */
  /* TWO, and each is a decision someone made: the shelf's cell and the card's
     sleeve. Counted rather than merely forbidden, so a third image has to come
     back through this gate and be argued for. */
  assert.equal((room.match(/<img/g) ?? []).length, 2,
    "the room may draw a publisher's cover on the shelf and on a card, and nothing else");
  assert.match(room, /face === "cover" && SHELF_ART\[chip\.id\] &&/,
    "the shelf's cover is drawn only when the reader asked for covers");
  assert.match(room, /const art = face === "cover" \? SHELF_ART\[entry\.sourceId\] : undefined;/,
    "and the card's is the same one choice, not a second one");
  assert.match(read("src/renderer/shelf-face.ts"), /const DEFAULT_FACE: ShelfFace = "mark";/,
    "the shipped face must be the packaged mark, which fetches nothing");

  /* The element itself is not here. It was in the margin once, and being there
     is what killed it: the block unmounts on every study tab, passage and panel
     close, so an episode lasted exactly as long as a reader stayed put. The
     transport is in the app shell — components/PodcastPlayer — and a card now
     only presses play on it. */
  assert.doesNotMatch(room, /<audio/,
    "the margin must not own an audio element again — it cannot keep one alive");
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /<audio/, "the transport must be exactly where the guard below looks");
  assert.match(player, /preload="none"/, "audio must not be fetched before a reader presses play");
  /* See the sleeve note in trusted-resource-permissions: one image, the
     record's own, inside a dock that only exists after a press. */
  assert.doesNotMatch(player, /autoPlay|<iframe|<video/);
  assert.equal((player.match(/<img/g) ?? []).length, 1,
    "the player may draw the record's sleeve and nothing else");
});
