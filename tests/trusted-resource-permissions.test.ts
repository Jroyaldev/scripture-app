import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/** Approved for their official marks. No other source is. */
const APPROVED_MARK_SOURCES = ["working-preacher", "bibleproject", "the-gospel-coalition"];
/** Approved 2026-07-27 and 2026-07-29, shipping without a bundled sample manifest. */
const APPROVED_MARK_SOURCES_IMPORTED = ["enter-the-bible", "naked-bible", "spoken-gospel"];
const ALL_APPROVED_MARK_SOURCES = [...APPROVED_MARK_SOURCES, ...APPROVED_MARK_SOURCES_IMPORTED];

/**
 * The public-feed footing, drawing a device — 2026-07-30.
 *
 * The maintainer decided on 2026-07-30 that the five sources added on the
 * public-feed footing may carry their real marks, on the same terms the rest
 * of this file describes: honorary permission sought before any public
 * listing, takedowns honoured on request. The decision is recorded and dated
 * at the head of docs/trusted-resource-permissions.md.
 *
 * These two are held in their OWN list rather than folded into the granted
 * ones, and that separation is the point of the change rather than an
 * accident of it: the granted-vs-unasked segmentation is what makes the later
 * approval round possible, and a list that quietly merges is exactly the
 * failure the permissions document is built to prevent. Nothing about the
 * artwork's treatment differs; what differs is which conversation is still
 * owed, and this constant is where the code says so.
 */
const DEVICE_SOURCES_PUBLIC_FEED = ["five-minutes-church-history"];

test("reviewed manifests and cards retain the common link-only permission boundary", () => {
  for (const source of APPROVED_MARK_SOURCES) {
    const manifest = read(`data/resources/${source}/manifest.json`);
    assert.match(manifest, /"permissions": "outbound-link-only"/);
    assert.match(manifest, /"capabilities": \["outbound-link"\]/);
    assert.doesNotMatch(manifest, /"(?:body|description|excerpt|artworkUrl|logoUrl|embedUrl|mediaUrl)"/);
  }

  /* Restated 2026-07-30: the publisher index became the Resources room, and the
     boundary moved with the work rather than lapsing with the block. */
  const block = read("src/renderer/components/Resources.tsx");
  assert.match(block, /openOfficial/);
  /* Audio is now permitted, for a source that declared where its media lives,
     played only when a reader presses play. Everything else the boundary
     refused is still refused, and the one permission granted is held to its
     terms: `preload="none"` is what makes "on press" true rather than merely
     intended — without it the element fetches from the publisher the moment a
     card renders, which is the surveillance the boundary exists to prevent.

     The element sits in components/PodcastPlayer now rather than in the card,
     because a card is torn down on every study tab and an episode should not
     be. Where it lives changes nothing about what it may do, so the terms are
     asserted there — and there is still exactly ONE of it in the renderer,
     which is what stops two publishers playing over each other. */
  assert.doesNotMatch(block, /<img|<iframe|<video|fetch\(|>Save/);
  assert.doesNotMatch(block, /<audio/);

  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /<audio/);
  assert.match(player, /preload="none"/);
  assert.doesNotMatch(player, /autoPlay|<img|<iframe|<video|fetch\(/);

  const renderer = resolve(root, "src/renderer");
  const elements = readdirSync(renderer, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .filter((entry) => /<audio/.test(readFileSync(resolve(renderer, entry), "utf8")));
  assert.deepEqual(elements, ["components/PodcastPlayer.tsx"],
    "one element for the whole app, or two episodes can run at once");
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

/**
 * The device is the same guard one step narrower, and it is asserted
 * separately so the two footings cannot be read off one list.
 *
 * A device is drawn BESIDE the publisher's name rather than instead of it, so
 * it is `--resource-device` and never `--resource-mark`. Keeping the two
 * properties apart is what keeps the two grants apart in `grep`.
 */
test("devices ship only for the sources the 2026-07-30 decision named", () => {
  const css = read("src/renderer/styles.css");
  const deviceRules = css.match(/--resource-device:\s*url\("[^"]+"\)/g) ?? [];
  assert.equal(deviceRules.length, DEVICE_SOURCES_PUBLIC_FEED.length);

  for (const rule of deviceRules) {
    const url = /url\("([^"]+)"\)/.exec(rule)?.[1] ?? "";
    assert.match(url, /^\.\/assets\/brand\//, "a device must be a bundled local asset, never a publisher URL");
    assert.ok(existsSync(resolve(root, "src/renderer", url)), `missing bundled device: ${url}`);
  }

  for (const source of DEVICE_SOURCES_PUBLIC_FEED) {
    assert.match(css, new RegExp(String.raw`\.taught-here-plate\[data-source="${source}"\][^}]*--resource-device:\s*url\(`),
      `${source} must declare its own device`);
    /* And a device NEVER takes the mark slot: the name it stands beside is
       what identifies the show, and --resource-mark would indent that name
       off-screen. */
    assert.doesNotMatch(css, new RegExp(String.raw`\.taught-here-plate\[data-source="${source}"\][^}]*--resource-mark:\s*url\(`),
      `${source} is a device beside a name, never a mark in place of one`);
  }

  assert.match(css, /--resource-device:\s*none;/, "the default must carry no device");

  /* Nothing in pending/ may be reached by either property. It is a staging
     area — it holds one asset explicitly marked as reconstructed rather than
     supplied — and the renderer must not be able to find it. */
  for (const rule of [...deviceRules, ...(css.match(/--resource-mark:\s*url\("[^"]+"\)/g) ?? [])]) {
    assert.doesNotMatch(rule, /assets\/brand\/pending\//,
      "a staged asset is being drawn; pending/ is not approved artwork");
  }
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

test("audio built ahead of permission stays declared as such wherever it appears", () => {
  /* BibleProject audio was wired on 2026-07-27 at the maintainer's instruction,
     explicitly before asking them, so the request could be made against a
     working thing. That is a reasonable way to build and a terrible thing to
     forget, because nothing about an un-asked-for capability looks different
     from an approved one once it is in the tree.

     So the three places that carry it are tied together. Add the host and the
     disclosure must exist; delete the disclosure and this fails while the host
     is still live. The only way to make this test quiet is to remove the
     capability or to come back and record that it was granted. */
  const simplecast = "afp-597195-injected.calisto.simplecastaudio.com";
  const built = read("scripts/build-renderer.mjs");
  const dev = read("src/renderer/index.html");
  const review = read("docs/trusted-resource-permissions.md");
  const importer = read("scripts/import-bibleproject-resources.ts");

  const inPolicy = built.includes(simplecast) || dev.includes(simplecast);
  const inImporter = importer.includes(simplecast);

  if (inPolicy || inImporter) {
    assert.match(review, /BibleProject audio — BUILT, NOT GRANTED/,
      "BibleProject audio is wired but the permission review no longer says it is ungranted");
    assert.match(review, /must not ship until BibleProject grants it/);
    // And the withdrawal steps stay written down, because a capability nobody
    // remembers how to remove is one nobody removes.
    assert.match(review, /drop `mediaHosts` from the source/);
  }

  /* Both copies of the policy or neither. A media host added to the dev server's
     page and not to the one that ships reads as working and silently blocks —
     and the reverse ships a permission the developer never saw. */
  assert.equal(built.includes(simplecast), dev.includes(simplecast),
    "the two content-security policies disagree about the Simplecast media host");
});
