import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { RELATION_WORDS_FIXTURE, relationSaid } from "../src/core/relation-words.js";
import type { ReferenceRelation } from "../src/core/references.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/**
 * The merged surface — one place a chapter's episode audio is offered.
 *
 * Two blocks used to answer one question. For the reference chapter, 25 of 28
 * episodes appeared on both of them: two mastheads, two orderings, two brand
 * policies, two play semantics, and identity keys that were the same string —
 * which is what made pressing a moment for an already-running episode pause it
 * instead of jumping, a defect that had to be patched in the transport rather
 * than removed at its cause.
 *
 * This file is what stops them growing back apart. Every assertion here failed
 * before 2026-07-30.
 */

const RELATIONS: ReferenceRelation[] = ["subject", "crossref", "mention", "allusion"];

test("a chapter's episode audio is offered on exactly one surface", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");

  /* The publisher index starts nothing. Every record carrying an audioUrl —
     which is precisely the set that used to draw a play button here — is cut
     out before the block ever sees it. */
  assert.doesNotMatch(margin, /TransportPlayButton/,
    "the publisher index is starting audio again; that is the duplication coming back");
  assert.match(margin, /const audioResources = useMemo\(/);
  assert.match(margin, /const linkResources = useMemo\(/);
  assert.match(margin, /trustedResources\.filter\(\(resource\) => Boolean\(resource\.record\.audioUrl\)\)/);
  assert.match(margin, /trustedResources\.filter\(\(resource\) => !resource\.record\.audioUrl\)/);
  assert.match(margin, /<TrustedResourcesBlock resources=\{linkResources\}/);

  /* And the merged surface takes both inputs, at every one of the margin's
     three mutually exclusive states. */
  const mounts = margin.match(/<TaughtHere\b/g) ?? [];
  assert.equal(mounts.length, 3,
    `the merged surface is mounted ${mounts.length} times; the margin has three states`);
  for (const mount of margin.split("<TaughtHere").slice(1)) {
    const props = mount.slice(0, mount.indexOf("/>"));
    assert.match(props, /moments=\{taughtHere\}/);
    assert.match(props, /records=\{audioResources\}/);
  }

  /* One key, one episode. Both kinds of entry are filed under the same string
     the transport keys on, so a title-level claim and the transcript's own
     answer for the same episode cannot both be drawn. */
  const surface = read("src/renderer/components/TaughtHere.tsx");
  assert.match(surface, /const key = `\$\{moment\.sourceId\}:\$\{moment\.id\}`/);
  assert.match(surface, /const key = `\$\{record\.source\.id\}:\$\{record\.record\.id\}`/);
  assert.match(surface, /if \(held\.has\(key\)[^)]*\) continue;/);

  /* Nothing else in the renderer may start an episode: two entry points is how
     two surfaces get built again. */
  const renderer = resolve(root, "src/renderer");
  const callers = readdirSync(renderer, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .filter((entry) => /playPodcastEpisode\(/.test(readFileSync(resolve(renderer, entry), "utf8")))
    .sort();
  assert.deepEqual(callers, ["components/PodcastPlayer.tsx", "components/TaughtHere.tsx"],
    "an episode may be started from the merged surface and from the transport, and nowhere else");
});

test("every row of the merged surface obeys one grammar", () => {
  const surface = read("src/renderer/components/TaughtHere.tsx");
  const row = surface.slice(surface.indexOf("const row = (entry: Entry)"), surface.indexOf("return (\n    <section"));

  for (const part of [
    "taught-here-play",     // the transport's own face, at 22px
    "taught-here-episode",  // who is speaking, in the reading face
    "taught-here-extent",   // how long, which is what a reader chooses on
    "taught-here-plate",    // the publisher, in the one form permitted off their surface
    "taught-here-ref",      // which passage
    "taught-here-said",     // in what way, in English
  ]) {
    assert.ok(row.includes(part), `the row grammar lost ${part}`);
  }

  /* The row IS the control. A second button inside it would be a second tab
     stop for one offer, and a 22px target inside a 300px row. */
  assert.match(row, /<TransportPlayMark/);
  assert.equal((row.match(/<button/g) ?? []).length, 1,
    "a row holds exactly one control, and it is the row");

  /* The timestamp is drawn where there is one, and only where there is one: a
     title-level claim has no second to name and must not invent one. */
  assert.match(row, /\{entry\.timed && <span className="taught-here-at">/);
});

test("no relation reaches a reader as a schema token or as nothing", () => {
  /* 23,169 moments — 56% of the corpus — were labelled `crossref`, `mention`,
     or with an empty span. The words live in core because two surfaces say
     them, and two copies had already drifted: the margin printed "alluded"
     and the dock printed "alluded" for allusions and nothing at all for the
     other two. */
  for (const relation of RELATIONS) {
    const said = relationSaid(relation);
    assert.ok(said.length > 0, `${relation} says nothing`);
    assert.notEqual(said, relation, `${relation} is printed as its own schema token`);
    assert.doesNotMatch(said, /^(crossref|subject|mention|allusion)$/);
  }
  assert.equal(RELATION_WORDS_FIXTURE.length, RELATIONS.length,
    "a relation was added to the schema without a word for it");

  const surface = read("src/renderer/components/TaughtHere.tsx");
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  for (const [name, source] of [["the margin", surface], ["the dock", player]] as const) {
    assert.match(source, /from "\.\.\/\.\.\/core\/relation-words\.js"/,
      `${name} is not reading the one relation vocabulary`);
    /* The old shapes, both of them, named so they cannot come back quietly. */
    assert.doesNotMatch(source, /relation === "allusion" \? "alluded" : ""/);
    assert.doesNotMatch(source, /\{m\.relation\}/);
  }
});

test("density is a control, and it says what it is holding back", () => {
  const surface = read("src/renderer/components/TaughtHere.tsx");

  /* Genesis 1 holds 922 moments. The band used to show 25 and then a plain
     <li> reading "897 more, shortest last" — a sentence shaped like a
     disclosure standing in front of 97% of the answer, beside a stylesheet
     that still carried a button's worth of rules for a control somebody had
     removed. */
  assert.doesNotMatch(surface, /className="taught-here-tail"/,
    "the inert tail is back in front of the rest of the answer");
  assert.match(surface, /<button[^>]*className="taught-here-more"/s);
  assert.match(surface, /className="taught-here-more is-all"/);
  assert.match(surface, /shortest last/,
    "a partial list must say what order it is holding the rest in");

  /* Both controls actually reveal: one page, or all of it. */
  assert.match(surface, /setShown\(\(previous\) => \(\{ \.\.\.previous, \[band\.key\]: limit \+ PAGE \}\)\)/);
  assert.match(surface, /setShown\(\(previous\) => \(\{ \.\.\.previous, \[band\.key\]: band\.items\.length \}\)\)/);

  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.taught-here-list \{[^}]*max-height: 300px/s,
    "the band needs its own scroll, or 'all' is a panel nobody can leave");
});

test("the two footings reach the surfaces that show them", () => {
  /* docs/trusted-resource-permissions says the distinction "must stay
     visible". Until 2026-07-30 the only places it was visible were a
     TypeScript literal and a test, while 48% of every surfaced moment came
     from a publisher nobody has asked. */
  const index = read("src/core/passage-index.ts");
  assert.match(index, /basis: TranscriptBasis/);
  assert.match(index, /transcriptBasis\(m\.id\) \?\? "public-feed"/,
    "the footing must be attached from the map, never read from the artifact");

  const surface = read("src/renderer/components/TaughtHere.tsx");
  assert.match(surface, /className="taught-here-footing"/);
  assert.match(surface, /Machine-read from published audio/);
  assert.match(surface, /not been asked yet/);

  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /className="podcast-episode-footing"/);
  assert.match(player, /transcriptBasis\(episode\.recordId\)/);
  assert.match(player, /We have not asked them yet/);

  /* It is said once per surface. A notice repeated on every row stops being
     read and starts being chrome — and it is a fact about a publisher rather
     than about an episode. */
  const row = surface.slice(surface.indexOf("const row = (entry: Entry)"), surface.indexOf("return (\n    <section"));
  assert.doesNotMatch(row, /basis|footing/,
    "the footing is a fact about a publisher, not a badge on every row");

  const doc = read("docs/trusted-resource-permissions.md");
  assert.match(doc, /Made true in the product, 2026-07-30/,
    "the doc still claims a visibility the product has to keep");
});

test("the walk is declared, finite, and never a radio", () => {
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  const surface = read("src/renderer/components/TaughtHere.tsx");

  /* Its whole extent is stated before it is pressed: how many, in what order,
     and how long altogether. */
  assert.match(surface, /treatments, longest first, \$\{walkLength\} in all/);
  assert.match(surface, /const WALK_STOPS = \d+;/, "a walk with no ceiling is a station");
  assert.match(surface, /\.slice\(0, WALK_STOPS\)/);
  assert.match(surface, /walkStops\.length > 1 &&/,
    "a walk of one is an episode with extra words on the button");

  /* It advances on the file running past the end of a SPAN, from the element's
     own clock — never on a timer, and never into anything the reader was not
     shown. */
  assert.match(player, /function walkPastEnd\(at: number\): void/);
  assert.match(player, /if \(!held \|\| !stop \|\| at < stop\.until\) return;/);
  assert.match(player, /if \(held\.at \+ 1 >= held\.stops\.length\) \{ announceWalk\(null\); pausePodcast\(\); return; \}/,
    "the walk must END rather than roll on");
  assert.doesNotMatch(player, /setInterval|setTimeout\([^)]*walk/i);

  /* Anything the reader starts by hand ends it. A list that keeps advancing
     after you chose something else is the behaviour this refuses. */
  assert.match(player, /if \(!walking && walk\) announceWalk\(null\);/);

  /* The system's next/previous exist only while it is running: an engine given
     a `nexttrack` handler draws the button whether or not there is a next. */
  assert.match(player, /\.\.\.\(walkActive\n\s*\? \(\[\n\s*\["previoustrack"/);
  assert.match(player, /\}, \[episodeId, episodeSource, episodeTitle, walkActive\]\);/);
});

test("the merged surface is covered in every atmosphere it can be read in", () => {
  const styles = read("src/renderer/styles.css");
  const family = styles.slice(styles.indexOf(".taught-here {"), styles.indexOf(".trusted-resources {"));

  /* None of this existed. Two real <button>s took the UA's default ring
     against a pebble radius while every neighbouring family used the seal;
     there was no forced-colors block naming any taught-here class; and the
     chevron rotated 90° with no reduced-motion opt-out. */
  for (const control of ["row", "toggle", "more", "walk"]) {
    assert.match(family, new RegExp(`\\.taught-here-${control}:focus-visible`),
      `.taught-here-${control} has no focus ring of its own`);
  }
  /* And none of them is inset: an inset ring lands on the element's own fill
     (Rev 04 §4). The running row's forced-colors outline IS inset, on purpose
     and deliberately not a focus ring — a state mark on a row that has no ring
     of its own to collide with — so the rule is asserted where it applies. */
  for (const [, block] of family.matchAll(/:focus-visible[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(block, /outline-offset: -\d/,
      `an inset focus ring on the merged surface: ${block.trim()}`);
  }

  assert.match(family, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(family, /@media \(forced-colors: active\)/);
  assert.match(family, /\.taught-here-plate \{ forced-color-adjust: none; \}/,
    "the plate is the one opt-out, for the same reason the dock's is");

  /* Tokenised throughout, so it answers all four atmospheres. The plate is the
     exception and it is declared per source, outside this block. */
  const body = family.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/,
    "a hardcoded colour on the margin's own paper cannot follow the theme");
});

test("the dock's passage chip says something true, and stays reachable", () => {
  const player = read("src/renderer/components/PodcastPlayer.tsx");

  /* Its accessible name claimed "the passage this episode works through" while
     its bref was the READER's own chapter at verse 1, handed over by all three
     margin call sites — false for every one of the 41,426 launches from that
     surface, and its press replaced the reader's selection with verse 1. */
  assert.doesNotMatch(player, /the passage this episode works through/);
  assert.match(player, /the passage playing here/);
  assert.match(player, /the passage this episode is filed under/);

  /* And it used to be removed from the DOM by `!expanded` — taken away at
     exactly the moment the reader had the passage list open. */
  assert.doesNotMatch(player, /\{passage && !expanded &&/);

  /* A chapter claim reaches the canvas as a chapter. `bref:v1/ROM.8.1` is
     written for both "Romans 8" and "Romans 8:1"; reading it as the second is
     what collapsed selections onto verse 1. */
  assert.match(player, /verse: verse === 1 && endVerse == null \? null : verse/);
  assert.match(player, /target\.verse \?\? undefined/);
});

test("the transcript consults the reference set it has always held", () => {
  const player = read("src/renderer/components/PodcastPlayer.tsx");

  /* Loaded, validated and in this component's own state since the first draft;
     never once read by the list. A listener who heard "turn to Romans 8" saw
     plain text whose only behaviour was to seek to itself. */
  assert.match(player, /const citedLines = useMemo\(/);
  assert.match(player, /className="podcast-transcript-cite"/);

  /* Line-level only, by standing decision: 24,995 word timings are in the
     payload and a chip on every proper noun stops being something anyone
     reads. */
  assert.doesNotMatch(player, /transcript\.words\.map|per-word|wordIndex/i);

  /* Beside the line, never inside it: the line's press has to keep meaning
     "play from here", and a control inside a control is markup nothing can
     resolve. */
  const line = player.slice(player.indexOf("const renderedLines = useMemo("), player.indexOf("── One tab stop"));
  assert.ok(line.indexOf('className="podcast-transcript-cites"') > line.indexOf("</button>"),
    "a passage mark is nested inside the transcript line it belongs to");

  /* And the rail's ticks, which were coded, styled, and fed by the one array
     the type documents as never supplied. */
  assert.match(player, /const scrubTicks = useMemo\(/);
  assert.match(player, /\(refs\?\.references \?\? \[\]\)\.map\(\(reference\) => reference\.at\)/);
});

test("listening survives a restart, and the offer fetches nothing", () => {
  const main = read("src/electron/main.ts");
  assert.match(main, /lastHeard: \{/, "the settings schema does not keep a place for the voice");
  assert.match(main, /function normalizeLastHeard/);
  /* Fails the whole record closed. A half-remembered episode is a play button
     leading somewhere unknown, and the URL is the only thing this app will
     ever hand to a media element. */
  assert.match(main, /if \(!\(candidate\["audioUrl"\] as string\)\.startsWith\("https:\/\/"\)\) return null;/);
  assert.match(main, /lastHeard: normalizeLastHeard\(settled\.lastHeard\)/);
  assert.match(main, /lastHeard: normalizeLastHeard\(hasLastHeard \? partial\.lastHeard : store\.store\.lastHeard\)/);

  /* The STUDY-WORKSPACE validator is a different store and is not touched. */
  assert.match(main, /bootstrapStudyWorkspaceSetting\(/);
  assert.match(main, /mergeRawStudyWorkspaceSetting\(/);

  const player = read("src/renderer/components/PodcastPlayer.tsx");
  /* An OFFER, not a resumption: nothing may be fetched before a reader presses
     play, and a cold start that restored audio nobody asked for would be an
     odd place to break the boundary the whole surface is built around. */
  assert.match(player, /export function offerPodcastHeard/);
  assert.match(player, /if \(nowPlaying\.episode\) return;/);
  assert.match(player, /className="podcast-resume"/);
  assert.match(player, /`Resume · \$\{formatClock\(heard\.positionSeconds\)\}`/);
  /* Written at a cadence, and exactly on a pause. */
  assert.match(player, /const HEARD_CADENCE_MS = 15_000;/);
  assert.match(player, /rememberHeard\(event\.currentTarget\.currentTime, \{ force: true \}\)/);
  /* Closing the dock is the reader saying they are done. */
  assert.match(player, /forgetHeard\(\);\n\s*announceElapsed\(0, 0\);/);

  /* And it takes the same reservation as the dock, or it lands on the panel. */
  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.app-shell:has\(\.podcast-resume\) \.living-margin \{/);
  assert.match(styles, /\.app-shell:has\(\.podcast-resume\) \+ \.toast-container/);
});
