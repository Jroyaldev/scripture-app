import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { RELATION_WORDS_FIXTURE, relationSaid } from "../src/core/relation-words.js";
import type { ReferenceRelation } from "../src/core/references.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/**
 * The file with its prose taken out.
 *
 * Every "this must not appear" assertion below is about what the CODE does,
 * and every one of them would otherwise be defeated by a comment explaining
 * why the thing was removed — which is exactly the comment this codebase asks
 * for. The bands, the drawer, the ops sentence and the gain graph are all
 * named in prose immediately above the code that replaced them.
 */
const code = (path: string): string => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/(^|[^:\w"'`])\/\/.*$/, "$1"))
  .join("\n");

/**
 * The Resources room, the study column's two residents, and the player that
 * shares it.
 *
 * ── What this file was · restated 2026-07-30 ────────────────────────────────
 *
 * It was `taught-here-contract`, and it held one finding: two blocks answering
 * one question. For the reference chapter, 25 of 28 episodes appeared on both
 * of them — two mastheads, two orderings, two brand policies, two play
 * semantics, and identity keys that were the same string, which is what made
 * pressing a moment for an already-running episode pause it instead of jumping.
 *
 * That finding is unchanged and every assertion protecting it is still here.
 * What changed is where the one answer lives and how it is drawn: a lens of its
 * own rather than a block at the foot of Overview, cards rather than rows, a
 * room rather than three shut drawers, and a study column whose two residents —
 * that panel and the player — take turns instead of overlapping.
 *
 * Everything below is contract except the DISCOVERY SHAPE, which is the one
 * open question of this wave and is asserted only to the extent that it must
 * not become a product control.
 */

const RELATIONS: ReferenceRelation[] = ["subject", "crossref", "mention", "allusion"];

test("a chapter's material is offered in exactly one room", () => {
  const margin = read("src/renderer/components/LivingMargin.tsx");

  /* The publisher index starts nothing, and no longer exists as a second
     surface at all: every record carrying an audioUrl — which is precisely the
     set that used to draw a play button in it — and every link-only record go
     to the same room, under one card and one key. */
  assert.doesNotMatch(margin, /TransportPlayButton/,
    "the margin is starting audio outside the room again; that is the duplication coming back");
  assert.doesNotMatch(margin, /function TrustedResourcesBlock/, "the second surface is back");
  assert.match(margin, /const audioResources = useMemo\(/);
  assert.match(margin, /const linkResources = useMemo\(/);
  assert.match(margin, /trustedResources\.filter\(\(resource\) => Boolean\(resource\.record\.audioUrl\)\)/);
  assert.match(margin, /trustedResources\.filter\(\(resource\) => !resource\.record\.audioUrl\)/);

  /* And the room takes all three inputs, at every one of the margin's three
     mutually exclusive states. */
  const mounts = margin.match(/<Resources\n/g) ?? [];
  assert.equal(mounts.length, 3,
    `the room is mounted ${mounts.length} times; the margin has three states`);
  for (const mount of margin.split("<Resources\n").slice(1)) {
    const props = mount.slice(0, mount.indexOf("/>"));
    assert.match(props, /moments=\{taughtHere\}/);
    assert.match(props, /records=\{audioResources\}/);
    assert.match(props, /links=\{linkResources\}/);
  }

  /* Overview keeps a digest and a door, and the digest is the same card the
     room draws — one geometry, two placements. */
  const digests = margin.match(/<ResourcesDigest\b/g) ?? [];
  assert.equal(digests.length, 3, "Overview's digest is missing from one of the margin's states");
  assert.match(margin, /onOpen=\{\(\) => activateTab\("resources", true\)\}/,
    "the door must open the lens, not scroll to a block");

  /* One key, one episode. Both kinds of entry are filed under the same string
     the transport keys on, so a title-level claim and the transcript's own
     answer for the same episode cannot both be drawn. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /const key = `\$\{moment\.sourceId\}:\$\{moment\.id\}`/);
  assert.match(room, /const key = `\$\{record\.source\.id\}:\$\{record\.record\.id\}`/);
  assert.match(room, /if \(held\.has\(key\)[^)]*\) continue;/);

  /* Nothing else in the renderer may start an episode: two entry points is how
     two surfaces get built again. */
  const renderer = resolve(root, "src/renderer");
  const callers = readdirSync(renderer, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .filter((entry) => /playPodcastEpisode\(/.test(readFileSync(resolve(renderer, entry), "utf8")))
    .sort();
  assert.deepEqual(callers, ["components/PodcastPlayer.tsx", "components/Resources.tsx"],
    "an episode may be started from the room and from the transport, and nowhere else");
});

test("every card obeys one face, and the face refuses a fifth thing", () => {
  /* RESTATED 2026-07-30 · the row became a card.
     The row grammar was [play] title … extent / [plate] passage · time ·
     relation — six fragments on a 300px meta line that had to wrap to two. The
     card's face carries four things and no more: who made it, what it is,
     which passage, how long. Everything else the row said out loud is in the
     ORDERING now, which is silent. */
  const room = read("src/renderer/components/Resources.tsx");
  const card = room.slice(room.indexOf("function ResourceCard("), room.indexOf("* The two footings"));

  for (const part of [
    "resource-card-play",     // the transport's own face, at the room's scale
    "resource-card-plate",    // the publisher, in the one form permitted off their surface
    "resource-card-title",    // what the thing is called
    "resource-card-ref",      // which passage
    "resource-card-extent",   // how long, which is what a reader chooses on
  ]) {
    assert.ok(card.includes(part), `the card face lost ${part}`);
  }

  /* The card IS the control. A second button inside it would be a second tab
     stop for one offer. */
  assert.match(card, /<TransportPlayMark/);
  assert.equal((card.match(/<button/g) ?? []).length, 1,
    "a card holds exactly one control, and it is the card");

  /* THE FIFTH THING. None of these may appear on a face: the relation word,
     the timestamp inside the episode, the publisher's evidence sentence, a
     byline or a date. The relation and the timestamp are still SAID — in the
     accessible name, where a screen reader is owed the claim. */
  const face = card.slice(card.indexOf('<li className="resource-card"'));
  for (const forbidden of [/relationSaid\(/, /clockOf\(/, /evidence/, /metadata\?\./]) {
    assert.doesNotMatch(face, forbidden, `the card face is carrying ${forbidden} again`);
  }
  assert.match(card, /const spoken =/);
  assert.match(card, /aria-label=\{spoken\}/);

  /* Two sizes, and the second is earned by a treatment rather than by being
     first in a thin list. */
  assert.match(room, /data-weight=\{heavy \? "heavy" : "light"\}/);
  assert.match(room, /entry\.timed != null/);
  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.resource-card\[data-weight="heavy"\] \{[^}]*grid-column: 1 \/ -1/s);
});

test("aboutness decides order and size, and is never printed", () => {
  const room = read("src/renderer/components/Resources.tsx");
  /* The bands were the old way of saying this out loud: three drawers, three
     counts, and a heading over each. They are one function now, and it returns
     a number nobody sees. */
  assert.doesNotMatch(code("src/renderer/components/Resources.tsx"),
    /proximityOf|"On this passage"|"The chapter as a whole"|"Around it"/,
    "the proximity bands are back");
  assert.match(room, /function aboutness\(/);
  assert.match(room, /\.sort\(\(left, right\) => right\.weight - left\.weight\)/);
  /* Every term of it, so a future hand cannot quietly drop the one that makes
     the reader's own verse matter. */
  for (const term of [/const treatment =/, /const length =/, /const place =/, /const evidence =/]) {
    assert.match(room, term, `aboutness lost a term: ${term}`);
  }
  assert.doesNotMatch(room, /\{entry\.weight\}|weight\.toFixed/, "the score reached a reader");
});

test("no relation reaches a reader as a schema token or as nothing", () => {
  /* 23,169 moments — 56% of the corpus — were labelled `crossref`, `mention`,
     or with an empty span. The words live in core because two surfaces say
     them, and two copies had already drifted. */
  for (const relation of RELATIONS) {
    const said = relationSaid(relation);
    assert.ok(said.length > 0, `${relation} says nothing`);
    assert.notEqual(said, relation, `${relation} is printed as its own schema token`);
    assert.doesNotMatch(said, /^(crossref|subject|mention|allusion)$/);
  }
  assert.equal(RELATION_WORDS_FIXTURE.length, RELATIONS.length,
    "a relation was added to the schema without a word for it");

  const room = read("src/renderer/components/Resources.tsx");
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  for (const [name, source] of [["the room", room], ["the dock", player]] as const) {
    assert.match(source, /from "\.\.\/\.\.\/core\/relation-words\.js"/,
      `${name} is not reading the one relation vocabulary`);
    /* The old shapes, both of them, named so they cannot come back quietly. */
    assert.doesNotMatch(source, /relation === "allusion" \? "alluded" : ""/);
    assert.doesNotMatch(source, /\{m\.relation\}/);
  }
});

test("density is a room, not a drawer", () => {
  /* RESTATED 2026-07-30. This asserted that the density CONTROL existed —
     "N more, shortest last" as a button rather than as inert text — which was
     the right fix for a block that had to live at the foot of a tab. The
     reader rejected the whole shape: no drawers of 25, no inventory sentence,
     no counts standing in front of the answer. Genesis 1's 922 moments are 922
     cards, and the ordering is what makes the first screen the right one. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.doesNotMatch(code("src/renderer/components/Resources.tsx"),
    /shortest last|taught-here-more|setShown/,
    "the drawer is back in front of the answer");
  assert.doesNotMatch(room, /aria-expanded=\{isOpen\}|taught-here-toggle/, "the bands are back");
  assert.match(room, /\{shown\.map\(\(entry\) =>/, "the room must draw everything it holds");

  /* Nine hundred cards is only honest if they are cheap until they are near
     the viewport, and if the scrollbar does not lie while they wait. */
  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.resource-card \{[^}]*content-visibility: auto/s);
  assert.match(styles, /\.resource-card \{[^}]*contain-intrinsic-size/s);

  /* And the room is a grid, never a ribbon: nothing on this surface scrolls
     sideways or advances on its own. */
  assert.match(styles, /\.resource-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(room, /scrollIntoView|carousel|marquee/);
});

test("the publisher shelf is back, with its colours, its marks and its filter", () => {
  /* The merge deleted more than it meant to: six full-colour imprints in one
     glance, the `All` control, the publisher filter and the route into
     resource settings all went with the duplication, and what replaced them
     was one monochrome plate stamped four times down a column. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /className="trusted-resource-imprints resource-shelf"/);
  assert.match(room, /data-source=\{chip\.id\}/,
    "a shelf chip must carry its own source, or it cannot carry its own colour");
  assert.match(room, /aria-pressed=\{only === chip\.id\}/, "the shelf is a filter, not a drawer");
  assert.match(room, /className="trusted-resource-imprint is-all"/);
  assert.match(room, /className="trusted-resource-imprint is-settings"/);
  assert.match(room, /<ResourceLibraryMatrix/, "the route into settings is part of the shelf");

  /* The marks need a height to be drawn at, and the imprint had never been
     given one — the shared mark rule sizes artwork from --player-mark-h, which
     only the dock's plate and the row's declared. Every chip was an empty
     coloured pill with the name indented off-screen behind it. */
  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.resource-shelf \.trusted-resource-imprint \{[^}]*--player-mark-h:/s);
});

test("the two footings reach the surfaces that show them, in a reader's language", () => {
  /* docs/trusted-resource-permissions says the distinction "must stay
     visible". Until 2026-07-30 the only places it was visible were a
     TypeScript literal and a test, while 48% of every surfaced moment came
     from a publisher nobody has asked. */
  const index = read("src/core/passage-index.ts");
  assert.match(index, /basis: TranscriptBasis/);
  assert.match(index, /transcriptBasis\(m\.id\) \?\? "public-feed"/,
    "the footing must be attached from the map, never read from the artifact");

  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /className="taught-here-footing"/);
  assert.match(room, /export function footingSentence/);

  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /className="podcast-episode-footing"/);
  assert.match(player, /transcriptBasis\(episode\.recordId\)/);

  /* THE DISTINCTION SURVIVES: one sentence names a permission, the other names
     a public feed, and a reader can tell which they are looking at. */
  assert.match(room, /with their permission/);
  assert.match(room, /public feed/);
  assert.match(player, /with their permission/);
  assert.match(player, /public feed/);

  /* AND THE OPS LANGUAGE IS OFF THE READING SURFACES. "We have not asked them
     yet" and "1 of these 2 publishers gave permission; 1 has not been asked
     yet" are facts about our outreach backlog, printed where a reader reads. */
  for (const [name, path] of [
    ["the room", "src/renderer/components/Resources.tsx"],
    ["the dock", "src/renderer/components/PodcastPlayer.tsx"],
  ] as const) {
    assert.doesNotMatch(code(path), /not been asked|not asked them|have not asked|not yet asked/i,
      `${name} is telling a reader what is on our to-do list`);
  }

  /* It is said once per surface. A notice repeated on every card stops being
     read and starts being chrome — and it is a fact about a publisher rather
     than about an episode. */
  const card = room.slice(room.indexOf("function ResourceCard("), room.indexOf("* The two footings"));
  assert.doesNotMatch(card, /basis|footing/,
    "the footing is a fact about a publisher, not a badge on every card");

  const doc = read("docs/trusted-resource-permissions.md");
  assert.match(doc, /Made true in the product, 2026-07-30/,
    "the doc still claims a visibility the product has to keep");
});

test("the walk is declared, finite, and never a radio", () => {
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  const room = read("src/renderer/components/Resources.tsx");

  /* Its whole extent is stated before it is pressed: how many, in what order,
     and how long altogether. */
  assert.match(room, /treatments, longest first, \$\{walkLength\} in all/);
  assert.match(room, /const WALK_STOPS = \d+;/, "a walk with no ceiling is a station");
  assert.match(room, /\.slice\(0, WALK_STOPS\)/);
  assert.match(room, /walkStops\.length > 1 &&/,
    "a walk of one is an episode with extra words on the button");

  /* It advances on the file running past the end of a SPAN, from the element's
     own clock — never on a timer, and never into anything the reader was not
     shown. */
  assert.match(player, /function walkPastEnd\(at: number\): void/);
  assert.match(player, /if \(!held \|\| !stop \|\| at < stop\.until\) return;/);
  assert.match(player, /if \(held\.at \+ 1 >= held\.stops\.length\) \{ announceWalk\(null\); pausePodcast\(\); return; \}/,
    "the walk must END rather than roll on");
  assert.doesNotMatch(player, /setInterval|setTimeout\([^)]*walk/i);

  /* Anything the reader starts by hand ends it. */
  assert.match(player, /if \(!walking && walk\) announceWalk\(null\);/);

  /* The system's next/previous exist only while it is running. */
  assert.match(player, /\.\.\.\(walkActive\n\s*\? \(\[\n\s*\["previoustrack"/);
  assert.match(player, /\}, \[episodeId, episodeSource, episodeTitle, walkActive\]\);/);

  /* AND IT DOES NOT TAKE THE READER'S WORK WITH IT. Added 2026-07-30: the
     episode-change reset threw away the query, the mode, the view and the open
     sheet — right for a press, and silent theft for a walk advancing at the
     end of a treatment while the reader was reading in it. */
  assert.match(player, /launchedBy = walking \? "walk" : "reader";/);
  assert.match(player, /if \(podcastLaunchedBy\(\) === "walk"\) return;/,
    "a machine-initiated launch must leave the reader's lens alone");
});

test("the study column has two residents, and exactly one is unfolded", () => {
  /* NEW CONTRACT · 2026-07-30, and it supersedes Build 2's overlay geometry.
     The sheet used to open upward OVER the study panel, out of the panel's own
     reservation, so that nothing moved when it opened — which was honest about
     layout and dishonest about attention: an open sheet covered most of the
     margin, and two surfaces claimed one column at once. */
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const styles = read("src/renderer/styles.css");
  const css = read("src/renderer/styles/player.css");

  /* ONE boolean, on the module, read by both residents. Two copies is how a
     column ends up with two open panels, or none. */
  assert.match(player, /let playerExpanded = false;/);
  assert.match(player, /export function usePodcastExpanded\(\): boolean/);
  assert.match(player, /export function foldPodcastPlayer\(\): void/);
  assert.match(margin, /const playerOwnsColumn = usePodcastExpanded\(\);/);
  assert.match(margin, /onClick=\{foldPodcastPlayer\}/,
    "the folded tab must fold the player, not merely style itself");

  /* Stopping the player hands the column back. */
  assert.match(player, /announceExpanded\(false\);/,
    "closing the dock must give the column back to Study");

  /* The two residents share one width and one column top, so neither can hold
     a geometry the other disagrees with. */
  assert.match(styles, /--player-column-top: var\(--frame-top\);/);
  assert.match(styles, /--margin-fold-h: \d+px;/);
  assert.match(styles, /--player-column-w: clamp\(/);
  assert.match(css, /\.podcast-dock\[data-expanded="true"\] \{[\s\S]*width: var\(--player-column-w\);/);
  assert.match(styles, /\.living-margin\[data-folded="true"\] \{[\s\S]*width: var\(--player-column-w\);/);

  /* Folded is not closed: the panel keeps its state and its scroll, and is
     inert so nothing inside it can be reached or read aloud. */
  assert.match(margin, /inert=\{folded\}/);
  assert.match(styles, /\.living-margin\[data-folded="true"\] \.margin-workspace-panel \{[^}]*visibility: hidden/s);
  assert.doesNotMatch(styles, /\.living-margin\[data-folded="true"\] \.margin-workspace-panel \{[^}]*display: none/s);
});

test("the folded tab says what it is following, and nothing else", () => {
  /* NEW CONTRACT · 2026-07-30. A folded surface that summarises itself is not
     folded. One line in the app's kicker voice, an arrow, and — only when the
     reader's own work is on the verses in view — one seal dot. */
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const styles = read("src/renderer/styles.css");
  const tab = margin.slice(
    margin.indexOf("const foldTab = folded"),
    margin.indexOf("if (entityIntent && activeWorkspace"),
  );

  assert.match(tab, /className="margin-fold-line">\{`\$\{contextReference\} · \$\{foldedState\}`\}/);
  assert.match(tab, /\{foldedMine && <span aria-hidden="true" className="margin-fold-seal" \/>\}/);
  assert.match(margin, /const foldedMine = notesCount > 0 \|\| connectionCount > 0;/,
    "the seal is authorship — it may only mean the reader's own work");
  /* No count, no preview, no digest of what is behind it. */
  assert.doesNotMatch(tab, /notesCount\}|connectionCount\}|\.length\}|slice\(/,
    "the folded tab is summarising what it is hiding");
  /* The kicker voice, which is the same one the margin's own section kickers
     use — a label on a drawer, not a heading that lost its section. */
  assert.match(styles, /\.margin-fold-line \{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.margin-fold-line \{[^}]*letter-spacing: 0\.13em/s);
});

test("no hard cut: every start, stop, seek and boundary rides a ramp", () => {
  /* NEW CONTRACT · 2026-07-30. A file stopped at a waveform's midpoint clicks,
     and the click is louder than the voice it interrupts. */
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /const EASE_MS = 120;/);
  assert.match(player, /function ease\(to: number, then\?: \(\) => void\): void/);
  assert.match(player, /Math\.sin\(\(through \* Math\.PI\) \/ 2\)/,
    "equal-power, because a linear ramp of this length has an audible dip in it");

  /* Pause rides it down; play and resume ride up from silence; a seek drops
     the level across the discontinuity; the walk fades between two voices; and
     letting go of the file is the hardest cut of all. */
  assert.match(player, /ease\(0, \(\) => \{ element\.pause\(\); element\.volume = 1; \}\);/);
  /* And a reversal cancels the ramp it is reversing. A frame loop does not run
     while the window is behind another one, so a fade armed before a resume
     can land seconds after it and pause an episode that is already playing —
     which the QA tour found by bringing the window to the front to take a
     picture. */
  assert.match(player, /endEase\(\);\n\s*\/\* Up from silence/);
  assert.match(player, /endEase\(\);\n\s*element\.src = episode\.audioUrl;/);
  assert.match(player, /element\.volume = 0;\n\s*void element\.play\(\)\.then\(\(\) => ease\(1\)\)/);
  assert.match(player, /easeThrough\(\(\) => \{ element\.currentTime = clamped; \}\);/);
  assert.match(player, /ease\(0, \(\) => \{\n\s*announceWalk\(\{ \.\.\.held, at: index \}\);/);
  assert.match(player, /ease\(0, \(\) => \{\n\s*element\.pause\(\);\n\s*element\.removeAttribute\("src"\);/);

  /* It is element volume on a frame loop, not a WebAudio graph, and that is a
     decision: a MediaElementAudioSourceNode over a cross-origin file with no
     CORS headers is silenced by the engine, and these files come from
     publishers' own servers under a grant that says nothing about CORS. */
  assert.doesNotMatch(code("src/renderer/components/PodcastPlayer.tsx"),
    /AudioContext|createMediaElementSource|GainNode/,
    "a gain graph here mutes the app");
});

test("the regression audit's smallest fixes are in place", () => {
  /* Every one of these is a finding from the adversarial counter-audit of
     Builds 1–3, fixed at the size the audit argued for. They are asserted
     together because they were one pass, and because each is the kind of thing
     that comes back the moment nobody is looking at it. */
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  const css = read("src/renderer/styles/player.css");

  /* R1 · the dock at rest says what is playing. The title leads at full ink;
     the relation is a qualifier in the small UI face; and the mast's yield
     order ranks the reader's passage above the publisher's wordmark. */
  assert.match(player, /<span className="podcast-dock-now-title">\{episode\.title\}<\/span>\n\s*<span className="podcast-dock-now-said">/);
  assert.match(css, /\.podcast-dock-now-title \{[^}]*color: var\(--text-primary\)/s);
  assert.match(css, /\.podcast-dock-now-said \{[^}]*color: var\(--text-tertiary\)/s);
  assert.match(css, /\.podcast-mast-plate \{[\s\S]*max-width: 30%;/);

  /* R2 · a hovered line may never be louder than the playing one. Sharpness
     means playing and nothing else, so hover marks an edge and clears nothing. */
  const hover = css.slice(
    css.indexOf(".podcast-transcript-line:hover"),
    css.indexOf(".podcast-transcript-line:active"),
  );
  assert.match(hover, /box-shadow: inset 2px 0 0/);
  assert.doesNotMatch(hover, /filter: none/);
  assert.doesNotMatch(hover, /background:/);

  /* R3 · the ramp does not invert at its own edge. */
  assert.match(css, /\.podcast-transcript-line:not\(\[data-d\]\) \{ opacity: 0\.16; \}/);

  /* R4 · the scrollbar has a lane of its own and is never over CLEAR. */
  assert.match(css, /\.podcast-sheet-inner \{[^}]*scrollbar-gutter: stable/s);

  /* R5 · the sheet arrives against paper rather than against the panel's text. */
  assert.match(css, /\.podcast-sheet-inner \{[^}]*background: var\(--bg-float\)/s);

  /* R9 · the reaching scrubber's thumb is not pinned to 100%. */
  assert.match(player, /value=\{of > 0 \? Math\.floor\(position\) : 0\}/);

  /* C1 · the refusal has a way out again — the publisher's own page, which is
     where the episode is if it is anywhere. */
  assert.match(player, /className="podcast-mast-icon podcast-mast-out"/);
  assert.match(player, /aria-label=\{`Open \$\{episode\.title\} at \$\{episode\.sourceName\}/);
  assert.match(player, /\{status === "failed" && \(/,
    "the way out must be drawn in the refusal state and in no other");
  /* And it cannot be on the clock's own line: that column is ~226px and the
     sentence wants 223 of them, so a chip beside it ellipses the reason. */
  assert.doesNotMatch(css, /\.podcast-dock-refusal-out/);

  /* C5 · one tab idiom. The sheet's switcher takes the app's own law — ink and
     a seal on the edge nearest what it opens — rather than a filled pill. */
  assert.match(css, /\.podcast-view-tab::after \{[^}]*background: var\(--study-gold\)/s);
  assert.doesNotMatch(css, /\.podcast-view-tab\[aria-selected="true"\] \{[^}]*background: var\(--bg-float\)/s);

  /* C6 · the Follow pill has a lane and never parks on a line. */
  assert.match(css, /\.podcast-transcript-lane \{[^}]*height: 34px/s);
  assert.doesNotMatch(css, /\.podcast-transcript-follow \{[^}]*position: absolute/s);

  /* C7 · the unlabelled ring in the search row is gone rather than renamed. */
  assert.match(css, /::-webkit-search-cancel-button \{[^}]*display: none/s);
});

test("the discovery shape is the open question, and never a product control", () => {
  /* NOT FROZEN, and this is the only assertion about it: three renderings of
     the same cards and the same ordering, chosen from the document element so
     the reader can be shown all three from real data. It must not grow a
     chooser, a setting, or a persisted preference — that would make an open
     question look answered. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /const SHAPES = \["weight", "even", "spine"\] as const;/);
  assert.match(room, /document\.documentElement\.dataset\["discoveryShape"\]/);
  assert.doesNotMatch(room, /localStorage|window\.api\.settings|onShapeChange/,
    "the discovery shape is being remembered, which makes an open question look settled");
  assert.doesNotMatch(room, /aria-label="Choose a layout"|<select/);

  const vocabulary = read("scripts/qa-support/app-vocabulary.mjs");
  assert.match(vocabulary, /"data-discovery": \{[\s\S]*values: \["weight", "even", "spine", "digest"\]/);
});
