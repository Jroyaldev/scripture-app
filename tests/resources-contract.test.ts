import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { RELATION_WORDS_FIXTURE, relationSaid } from "../src/core/relation-words.js";
import type { ReferenceRelation } from "../src/core/references.js";
import { sameEpisode } from "../src/core/resources/audio-catalogue.js";

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
  /* THREE, since 2026-08-02, and the third is the point of this assertion
     rather than an exception to it. What the rule protects is that a launch
     goes through ONE function — `playPodcastEpisode` — so the walk is ended,
     the lens is reset, and exactly one audio element ever holds a file. The
     Listen room adds a way IN (a song, from a page organised by material
     rather than by passage) without adding a second transport: it shapes a
     track into the same episode and hands it to the same function. A fourth
     name appearing here is still the thing to stop; a second `new Audio` is
     what it was always really about, and the audio-element test above holds
     that separately. */
  assert.deepEqual(callers,
    ["components/ListenPage.tsx", "components/PodcastPlayer.tsx", "components/Resources.tsx"],
    "an episode may be started from the room, the Listen page and the transport, and nowhere else");
});

test("every card obeys one face, and the face refuses a fifth thing", () => {
  /* RESTATED 2026-07-30 · the row became a card.
     The row grammar was [play] title … extent / [plate] passage · time ·
     relation — six fragments on a 300px meta line that had to wrap to two. The
     card's face carries four things and no more: who made it, what it is,
     which passage, how long. Everything else the row said out loud is in the
     ORDERING now, which is silent. */
  const room = read("src/renderer/components/Resources.tsx");
  /* THE SLICE ENDS AT THE LIST · 2026-07-31. It ran to "* The two footings",
     which was the next thing in the file until the list view landed between
     them — and a slice that swallows a second component quietly turns "a card
     holds exactly one control" into "this region of the file holds one
     button", which is a weaker claim wearing the same words. The list makes
     the same promise about its own entries and is asserted where it lives. */
  const card = room.slice(room.indexOf("function ResourceCard("), room.indexOf("* ── THE LIST ·"));

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
  /* RESTATED 2026-07-31. This asserted `const spoken =` — the sentence composed
     INSIDE the card. It is `spokenFor` now, and the move is the point: the list
     view says the same sentence about the same entry, and two components each
     composing their own would drift, which is exactly how the surface this room
     replaced ended up with two brand policies over one set of episodes. */
  assert.match(card, /const spoken = spokenFor\(entry, running\);/);
  assert.match(card, /aria-label=\{spoken\}/);
  assert.match(room, /function spokenFor\(entry: ResourceEntry, running: boolean\): string/,
    "the entry's sentence must be said in one place for both forms of the room");

  /* Two sizes, and the second is earned by a treatment rather than by being
     first in a thin list. */
  assert.match(room, /data-weight=\{heavy \? "heavy" : "light"\}/);
  assert.match(room, /entry\.timed != null/);

  /* ── WHAT THE SECOND SIZE IS SPENT ON · RESTATED 2026-07-31 ──────────────
     This asserted `grid-column: 1 / -1` — the heavy card SPANNING BOTH COLUMNS.
     There is one column now (see `.resource-grid`), so a span is not a currency
     the family can spend and the assertion could only ever pass by accident.

     The claim under it never was about columns: the strongest answer in the
     room should look like the strongest answer. It is spent in TYPE, on the one
     thing a reader scans, and that is what is held here — a step on the title
     and nothing else, so the family cannot quietly grow a second difference and
     become the chart two sizes exist to avoid. */
  const styles = read("src/renderer/styles.css");
  assert.doesNotMatch(styles, /\.resource-card\[data-weight="heavy"\] \{[^}]*grid-column/s,
    "the heavy card is spanning columns again; there is only one");
  assert.match(styles,
    /\.resource-card\[data-weight="heavy"\] \.resource-card-title \{\s*\n\s*font-size: 0\.8125rem;\s*\n\s*\}/,
    "the second size lost the one difference it is allowed, or grew a second one");
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
  /* Restated 2026-07-30 again, when the run's index went with the run rule it
     served. What this holds — and all it ever held — is that the room draws
     `shown` ENTIRE: no slice, no page, no cap between the reader and the
     answer. The index the card no longer needs is not part of that claim. */
  assert.match(room, /\{shown\.map\(\(entry\) =>/, "the room must draw everything it holds");
  assert.doesNotMatch(code("src/renderer/components/Resources.tsx"), /shown\.slice\(/,
    "the room is capping the answer again");

  /* Nine hundred of anything is only honest if they are cheap until they are
     near the viewport, and if the scrollbar does not lie while they wait. Both
     forms of the room pay that price — added for the list 2026-07-31, because
     a list is denser and therefore draws MORE of them per screen, not fewer. */
  const styles = read("src/renderer/styles.css");
  assert.match(styles, /\.resource-card \{[^}]*content-visibility: auto/s);
  assert.match(styles, /\.resource-card \{[^}]*contain-intrinsic-size/s);
  assert.match(styles, /\.resource-entry \{[^}]*content-visibility: auto/s);
  assert.match(styles, /\.resource-entry \{[^}]*contain-intrinsic-size/s);

  /* ── ONE CARD PER ROW · RESTATED 2026-07-31 ──────────────────────────────
     This held `repeat(2, minmax(0, 1fr))`, under the heading "the room is a
     grid, never a ribbon". The maintainer reversed the column count — "make
     listing cards not stack side by side make them force full width" — and the
     reason the two-column rule gave for itself argues for one:

       "an `auto-fill` grid in a panel that can be 320–420px wide flickers
        between one column and two as the reader drags the window, and a room
        that reflows under the hand is not calm."

     A single track is the only count in this panel that cannot flicker at any
     width. So the claim is unchanged and stronger — a stable track count, and
     never a ribbon — and the number it is held at moved from two to one. */
  assert.match(styles, /\.resource-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\);/s,
    "the listings are stacking side by side again");
  assert.doesNotMatch(styles, /\.resource-grid \{[^}]*auto-fill/s,
    "the grid is deciding its own column count again; that is the reflow the two-column rule was written against");
  assert.doesNotMatch(room, /scrollIntoView|carousel|marquee/);
});

test("the publisher shelf is a register: quantised, one optical scale, and a filter that says so", () => {
  /* The merge deleted more than it meant to: six full-colour imprints in one
     glance, the `All` control, the publisher filter and the route into
     resource settings all went with the duplication, and what replaced them
     was one monochrome plate stamped four times down a column. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /className="trusted-resource-imprints resource-shelf"/);
  assert.match(room, /data-source=\{chip\.id\}/,
    "a shelf chip must carry its own source, or it cannot carry its own colour");
  assert.match(room, /aria-pressed=\{only === chip\.id\}/, "the shelf is a filter, not a drawer");
  assert.match(room, /<ResourceLibraryMatrix/, "the route into settings is part of the shelf");

  /* ── THE REGISTER · 2026-07-30 ────────────────────────────────────────────
     RESTATES two assertions that stood here for one build:

       assert.match(room, /className="trusted-resource-imprint is-all"/);
       assert.match(room, /className="trusted-resource-imprint is-settings"/);

     Both held that the way back to everything and the way into the library
     were PLATES in the row of publishers. On screen that made the shelf's two
     non-publishers look like publishers: `All` appeared mid-row and shoved
     whatever line it landed on, and "Your library" was an outlined pill among
     filled plates — the one control in the row that is not a publisher, and it
     read as a publisher that had failed to load.

     What those assertions were really guarding is that both routes EXIST on
     this surface. They still do, in the shelf's head, in the app's quiet
     action voice — so the claim survives and the shape does not. The register
     below the head is publishers and nothing else, which is what makes it a
     register. */
  assert.match(room, /className="resource-shelf-head"/,
    "the shelf's head is where its status and its two routes live");
  assert.match(room, /className="resource-shelf-action"[\s\S]{0,400}Show all/,
    "the way back to everything left the shelf");
  assert.match(room, /className="resource-shelf-action is-library"/,
    "the route into the library left the shelf");
  assert.doesNotMatch(room, /trusted-resource-imprint is-(all|settings)/,
    "a control that is not a publisher is wearing a publisher's plate again");

  /* The tally is unconditional. `chip.count > 1` left four of six plates on
     the reference chapter with no numeral at all, and a numeral column with
     holes in it is not a column. */
  assert.doesNotMatch(room, /chip\.count > 1 &&/,
    "the tally is conditional again; a one is a fact");

  /* ── THE LOGO-ONLY RACK · RESTATED 2026-07-31 ────────────────────────────
     Four assertions stood here and all four are quoted, because each was true
     of the shelf it was written for and none survives the reader's
     instruction: "what if shelf we did just logos so we can get them closer to
     same size and polish and made them bigger so each logo is bigger and not
     fighting against different word sizes".

       assert.match(shelfPlate, /pow\(var\(--resource-mark-ratio\)/,
         "the shelf sizes marks by nominal height again; logos of different
          aspect ratios do not read equal at equal height");
       assert.match(room, /"--imprint-measure": chip\.name\.length/,
         "the names lost their optical size; CSS cannot count characters");
       assert.match(shelfPlate, /min-width: calc\(50% - var\(--shelf-gap\) \/ 2\)/,
         "the register lost its track; the shelf is justified again");
       assert.match(imprint, /height: 26px/, …);

     The optical scale is KEPT and is the first assertion below — it is the one
     idea from the two-track register that a logo-only shelf needs more, not
     less. What it reads changed: --resource-symbol-ratio, the aspect of the
     publisher's symbol, where it read --resource-mark-ratio, the aspect of
     their whole lockup. That is the crop, and the crop is what made one box
     possible: eleven lockups run 0.768 to 8.015, eleven symbols 0.768 to
     3.266.

     The name ramp is gone because there are no names. The track floor is gone
     because there are no widths — see tests/resource-shelf-packing for the
     retirement. And the plate's height is 56 rather than 26, which is what
     "made them bigger" cost and bought. */
  const styles = read("src/renderer/styles.css");
  const shelfPlate = styles.slice(
    styles.indexOf(".resource-shelf .trusted-resource-imprint .trusted-resource-source"),
    styles.indexOf("/* ── The one narrowed to"),
  );
  assert.match(shelfPlate, /pow\(var\(--resource-symbol-ratio\)/,
    "the shelf sizes marks by nominal height again; logos of different aspect ratios do not read equal at equal height");
  assert.match(shelfPlate, /background: var\(--resource-symbol\) center \/ contain no-repeat/,
    "the shelf is drawing something other than the publisher's symbol");
  assert.doesNotMatch(room, /--imprint-measure/,
    "the shelf is setting a name in type again; that is the thing the marks were fighting");

  /* EVERY PUBLISHER, BY TOKEN AND NEVER BY NAME. The rule that paints the
     shelf and the rule that paints a card must both be enumeration-free: a
     per-source list is what left The Listener's cards drawing an empty plate,
     because one of the two lists that had to agree did not. */
  assert.doesNotMatch(shelfPlate, /\[data-source="/,
    "the shelf's drawing rule is enumerating publishers again");
  /* 11 → 12 with BEMA, 2026-08-02. The number is the publisher count and has
     to move with it; what the assertion guards is that it moves TOGETHER with
     the palette — a source onboarded without a symbol draws an empty plate,
     which is the defect the reader photographed. 30 Minutes in the New
     Testament is onboarded and deliberately NOT counted here: it has no
     palette block yet, and this test is what will say so when it gets one. */
  assert.equal((styles.match(/--resource-symbol: url\(/g) ?? []).length, 13,
    "every publisher in the app declares a symbol, or the rack has a hole in it");

  /* ── THE PLATE LAW · RESTATED 2026-07-31 ─────────────────────────────────
     The law is unchanged and the numbers moved: radius ≈ 0.22 × the shorter
     dimension, rounded even, CAPPED AT 8. At 26px that gave 6; at 56 it gives
     12.3, and the cap takes it to 8 — which is --radius-md, and is what stops
     a 56px plate becoming the full-round pill this shelf's first composition
     was rejected for. */
  const imprint = styles.slice(
    styles.indexOf("\n.trusted-resource-imprint {"),
    styles.indexOf("\n.trusted-resource-imprint:hover"),
  );
  assert.match(imprint, /height: 56px/, "the shelf plate left the size the reader asked for");
  assert.match(imprint, /border-radius: var\(--radius-md\)/,
    "the shelf plate is a pill again; 0.22 × 56 is 12.3, and the canon's cap is 8");
  assert.doesNotMatch(imprint, /--radius-page/);
  /* And the ink on that ground is DECLARED. Its absence is what set a
     <button>'s initial black on five publishers' own colours. */
  assert.match(imprint, /color: var\(--resource-ink\)/,
    "the shelf plate paints a ground and lets the ink fall where it may");

  /* ── HOVER · RESTATED 2026-07-30 ──────────────────────────────────────────
     What stood here banned `transform|box-shadow` outright on the hover rule,
     under the heading "No lift, no drop shadow. The app's hover language is
     ink and a ring." The ban and its own heading disagreed: a ring IS a
     box-shadow, so with the blunt ban the only hover the shelf could have was
     `filter: brightness(1.06)` — under a tenth of a stop, across eleven
     different grounds, which is nothing on any of them and told nobody the
     plate was pressable.

     The defect the ban was written for is the LIFT: a chip that translates and
     drops a shadow under a passing cursor, eleven at a time, on a reading
     surface. So the ban is now exactly that, and the ring its heading asks for
     is allowed on the inset channel. */
  const shelfHover = styles.slice(
    styles.indexOf(".resource-shelf .trusted-resource-imprint:hover"),
    styles.indexOf(".resource-shelf .trusted-resource-imprint[aria-pressed=\"true\"] {"),
  );
  assert.doesNotMatch(shelfHover, /transform|translate/,
    "the shelf plates lift off the page under the cursor again");
  assert.match(shelfHover, /--shelf-edge: inset /,
    "the hovered plate draws no edge; a tenth of a stop of brightness is not a hover");

  /* ── STATE · added 2026-07-30 ─────────────────────────────────────────────
     "The shelf is a FILTER, but every plate looks equally on." Chosen is Law
     2's own seal mark — the instrument the tab strip above this room already
     uses — in the APP's gold, on the edge nearest the room it opens, and it is
     drawn again on the outline channel for a forced palette, which suppresses
     box-shadow outright. */
  assert.match(styles, /\.resource-shelf \.trusted-resource-imprint\[aria-pressed="true"\] \{[^}]*--shelf-seal: 0 4px 0 -2px var\(--accent-seal\)/s,
    "the chosen publisher lost its seal mark");
  assert.match(styles, /forced-colors[\s\S]*\.resource-shelf \.trusted-resource-imprint\[aria-pressed="true"\] \{[^}]*outline: 2px solid Highlight/,
    "the one state on this shelf that carries meaning without words is drawn and then thrown away in a forced palette");
});

test("every card carries its publisher's mark", () => {
  /* CONTRACT REVERSED · 2026-07-30. What stood here for one build was "a
     publisher announces itself once per run": the first card of a run carried
     the wordmark and the cards under it carried the same plate reduced to the
     publisher's colour with the artwork withdrawn.

     The reader saw it drawn and rejected it: "i dont like how some lose the
     logo it just confuses. logo on every is better." A mark present on some
     cards and absent on others makes a reader ask what the difference means,
     and the true answer — that the card above happened to be the same
     publisher — is not worth the question it costs.

     So this test is the opposite of the one it replaces, and it guards the
     same defect from the other side: the mark is unconditional, and the
     machinery that made it conditional is gone rather than disabled. */
  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /<span className="taught-here-mark">\{entry\.sourceName\}<\/span>/,
    "the wordmark is conditional again");
  assert.doesNotMatch(room, /\brepeat\b|data-repeat|function runs\(/,
    "the run machinery is back; the mark is on every card or it is a rule again");

  const styles = read("src/renderer/styles.css");
  assert.doesNotMatch(styles, /\[data-repeat/,
    "the reduced plate's selectors are still standing");
  /* The redundancy the run rule was solving is real, and it moved into the
     four currencies a mark can be quiet in without being absent. The one that
     can be asserted from a file is the ground: it is what lets the plate stop
     being the whole of the identity. */
  assert.match(styles, /--resource-ground: oklch\(from var\(--resource-source\)/,
    "the card's ground is no longer derived from the publisher's own colour");
  assert.doesNotMatch(room, /APPROVED_MARKS|MARKED_SOURCES/,
    "the mark list is being duplicated out of the stylesheet into the component");

  /* ── ONE PLATE, ALL ELEVEN · added 2026-07-31 ────────────────────────────
     RESTATES the sentence that stood here: "The five unmarked sources have no
     artwork and keep their name in type — that is
     docs/trusted-resource-permissions' own generic treatment, and a permission
     decision rather than a design one."

     Neither half of that is true any more. There is no unmarked source — every
     publisher in the app declares --resource-symbol — and the footing that
     made it a permission question was flattened by the maintainer on
     2026-07-31 (see TRANSCRIPT_SOURCES). What the reader saw while both halves
     were still assumed was three kinds of plate in one grid and two kinds of
     nothing: an empty box for The Listener's and for Ask N.T. Wright, and "40
     MINUTES IN THE OLD TE…" for the sources that set a name.

     So the card's plate is ONE FIXED BOX painted from ONE RULE THAT NAMES
     NOBODY, and these three assertions are what hold that: a size, a token,
     and the absence of an enumeration. */
  const cardPlateAt = styles.indexOf(".resource-card .resource-card-plate[data-source] {");
  const cardPlate = styles.slice(
    cardPlateAt,
    styles.indexOf("\n}", styles.indexOf(".resource-card .resource-card-plate .taught-here-mark {", cardPlateAt)),
  );
  assert.match(cardPlate, /width: 56px;\s*\n\s*height: 28px;/,
    "the card's plate is not one box any more; a plate whose size follows its content is the ragged head the reader rejected");
  assert.match(cardPlate, /background: var\(--resource-symbol\) center \/ contain no-repeat/,
    "the card is drawing something other than the publisher's symbol");
  assert.doesNotMatch(cardPlate, /\[data-source="/,
    "the card's plate is enumerating publishers again; that is how two of them ended up with an empty box");
});

test("the card's ground is derived, not picked", () => {
  /* THE HOMAGE, AS A DERIVATION. The reader asked for "an homage toward the
     brands hue down to aesthetic muted alternatives", and the one way that
     stays true across eleven publishers and four atmospheres is to compute it:
     hue from the publisher, chroma clamped into a narrow band, lightness
     replaced by the atmosphere's own figure. A hand-picked hex per publisher
     per atmosphere is forty-four numbers nobody can check. */
  const styles = read("src/renderer/styles.css");
  const ground = styles.slice(styles.indexOf(".resource-card[data-source] {"));
  assert.match(ground, /var\(--ground-fit-l\)/, "the ground picks its own lightness");
  assert.match(ground, /clamp\(var\(--ground-fit-c-min\), c, var\(--ground-fit-c-max\)\)/,
    "the chroma is capped without a floor, or floored without a cap");
  /* Hue is the publisher's, untouched — the whole of what makes it an homage
     rather than a wash. */
  assert.match(ground, /var\(--ground-fit-c-max\)\)\s*\n\s*h\);/,
    "the ground is moving the publisher's hue");
  /* Both polarities declare the two numbers that have one. */
  assert.equal((styles.match(/--ground-fit-l:/g) ?? []).length, 2,
    "the ground fit has a light polarity and a dark one, and no more");
  assert.equal((styles.match(/--ground-fit-step:/g) ?? []).length, 2,
    "the edge step has a light polarity and a dark one, and no more");
  /* MEASURED, not adjusted by eye: the app's tertiary ink clears 4.5 against
     paper by a hair and does not clear it against a tinted card, so the card's
     quietest rank steps up one. qa-podcast-player sweeps the whole matrix in
     the running engine. */
  assert.match(styles,
    /\.resource-card\[data-source\] \.resource-card-extent,\s*\n\s*\.resource-card\[data-source\] \.resource-card-plate \.taught-here-mark \{\s*\n\s*color: var\(--text-secondary\);/,
    "the card's quietest ink is the tertiary again, which does not clear 4.5 on a tinted ground");
});

test("the list is the recovered masthead: runs, spines, and no artwork at all", () => {
  /* NEW CONTRACT · 2026-07-31, on the maintainer's instruction: "give a toggle
     for a list view where people can get more data in via list if the logo
     views are too much for them (not for shelf but for listings)".

     THE FORM WAS NOT INVENTED FOR THIS BUILD. It is the app's own resource
     masthead brought forward from ae15ab9, drawn at the real column width and
     approved that night. Everything asserted here is a clause of that
     grammar. */
  const room = read("src/renderer/components/Resources.tsx");
  const styles = read("src/renderer/styles.css");
  const list = room.slice(room.indexOf("* ── THE LIST ·"), room.indexOf("* ── THE TOGGLE ·"));

  /* ONE MASTHEAD, and it is the app's own element rather than a second set of
     declarations that says the same thing in four numbers. Two mastheads over
     one answer is the defect this whole room exists to have removed. */
  assert.match(room, /className=\{view === "list"\s*\n\s*\? "taught-here-masthead resource-list-masthead"/,
    "the list drew its own masthead instead of the app's");
  assert.match(room, /<span className="taught-here-kicker">From the transcripts<\/span>/);
  assert.match(styles, /\.taught-here-masthead \{[^}]*border-bottom: 3px solid var\(--text-primary\)/s,
    "the masthead's rule is a hairline again; a flag's rule is 3px in full ink");
  assert.match(styles, /\.taught-here-masthead :is\(h3, h4\) \{[^}]*font: 700 1rem\/1\.1/s);
  assert.match(styles, /\.taught-here-masthead :is\(h3, h4\) \{[^}]*letter-spacing: -0\.025em/s,
    "the flag lost its tight letterspacing");

  /* PUBLISHER RUNS: named once, at the head of their own run. This is NOT the
     run rule the card room reversed — that was about a MARK withdrawn from
     some cards and kept on others, and there are no marks here to withdraw. */
  assert.match(list, /className="resource-source resource-run-name" data-source=\{run\.id\}/);
  assert.match(room, /const runs = useMemo\(\(\) => \{/);
  assert.match(room, /for \(const entry of shown\) \{/,
    "the runs must be built from the same `shown` the cards draw — same filter, same entries");
  assert.match(styles, /\.resource-run-name \{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.resource-run-name \{[^}]*letter-spacing: 0\.09em/s);

  /* THE SPINE, and the hairline. Both are the grammar; neither is a box. */
  assert.match(styles, /\.resource-entry::before \{[^}]*background: var\(--resource-run-ink/s,
    "the entry's spine lost the publisher's colour");
  assert.match(styles, /\.resource-entry-face \{[^}]*border-top: 1px solid var\(--border-subtle\)/s);

  /* NO BOXES, NO TINTS, NO PLATES, NO ARTWORK. The mechanism, not the taste:
     it is the whole reason this form is denser than the cards. The one mark
     allowed is the app's transport on the entry that is actually playing. */
  assert.doesNotMatch(list, /taught-here-plate|taught-here-mark|resource-symbol|ResourceKindIcon/,
    "artwork is back on the list; the list is the answer to 'the logo views are too much'");
  assert.doesNotMatch(styles, /\.resource-entry-face \{[^}]*background: var\(--resource/s,
    "the entry is wearing the publisher's ground; brand here is colour and type only");
  assert.match(list, /\{running && \(\s*\n\s*<TransportPlayMark className="resource-entry-play"/,
    "the transport mark must be drawn on the playing entry and on no other");

  /* ONE CONTROL PER ENTRY, exactly as a card has one, and the SAME sentence. */
  assert.equal((list.match(/<button/g) ?? []).length, 1,
    "an entry holds exactly one control, and it is the entry");
  assert.match(list, /aria-label=\{spokenFor\(entry, running\)\}/,
    "the list is composing its own accessible sentence instead of the room's one");

  /* AND THE ORDER IS THE SAME ORDER, regrouped rather than re-sorted. A `sort`
     in here would be a second answer to the question the ranking answers. */
  assert.doesNotMatch(list, /\.sort\(/, "the list is re-ranking the room's answer");
  assert.doesNotMatch(room.slice(room.indexOf("const runs = useMemo"), room.indexOf("const heaviest")), /\.sort\(|\.slice\(/,
    "the runs are sorting or capping what the cards show whole");
});

test("a publisher's ink is derived for TYPE, and holds 4.5 on paper", () => {
  /* NEW CONTRACT · 2026-07-31. The list sets a publisher's NAME in their own
     colour, and --resource-source is a SURFACE colour picked to be painted
     behind a reverse mark: about half the shelf is too light to set type in and
     two are too dark to tell from the app's own ink. So it is derived, and the
     derivation is the third of a family — see the --ink-fit-* note at :root.

     A hand-picked ink per publisher per atmosphere is forty-four numbers nobody
     can check. The approved reference page hand-picked eleven; this is what
     replaces them. */
  const styles = read("src/renderer/styles.css");
  /* Bounded to the RULE. An unbounded slice runs to the end of the sheet and
     picks up every other fit in it, so "this ink is not borrowing the accent's
     clamp" would be answered by a rule four hundred lines away. */
  const inkAt = styles.indexOf(".resource-source[data-source] {");
  const ink = styles.slice(inkAt, styles.indexOf("\n}", inkAt) + 2);
  assert.match(ink, /--resource-run-ink: oklch\(from var\(--resource-source\)/,
    "the run's ink is no longer derived from the publisher's own colour");
  assert.match(ink, /clamp\(var\(--ink-fit-floor\), l, var\(--ink-fit-ceiling\)\)/,
    "the ink's lightness is unclamped, or clamped on one side only");
  assert.match(ink, /clamp\(0, c, var\(--ink-fit-c-max\)\)/,
    "the chroma ceiling is gone; a fully saturated hue vibrates at 9px");
  /* Hue is the publisher's, untouched — the same clause the ground's fit has,
     and the whole of what makes this their colour rather than a tint of ours. */
  assert.match(ink, /clamp\(0, c, var\(--ink-fit-c-max\)\)\s*\n\s*h\);/,
    "the ink is moving the publisher's hue");

  /* Two polarities for the number that has one, and ONE ceiling for the number
     that does not: a hue vibrating at 9px is not a fact about the atmosphere. */
  assert.equal((styles.match(/--ink-fit-floor:/g) ?? []).length, 2,
    "the ink fit has a light polarity and a dark one, and no more");
  assert.equal((styles.match(/--ink-fit-c-max:/g) ?? []).length, 1,
    "the chroma ceiling grew a polarity it has no reason for");

  /* NOT --accent-fit-*, which is the obvious thing to reach for and is the
     wrong direction: its 0.52 ceiling is chosen so the app's PAPER reads on the
     accent, and read the other way round it is inside the margin of error for a
     saturated hue rather than outside it. */
  assert.doesNotMatch(ink, /accent-fit/,
    "the run's ink is borrowing the accent's clamp; that clamp is for paper on a mark, not a mark on paper");

  /* And the hook is the palette's own, so no publisher can be left off a list.
     `.resource-source` is declared by all twelve brand blocks (BEMA and 30
     Minutes in the New Testament both joined 2026-08-02). */
  assert.equal((styles.match(/^\.resource-source\[data-source="/gm) ?? []).length, 13,
    "a publisher lost the palette hook the list paints from");

  /* qa-podcast-player measures all eleven × four atmospheres in the running
     engine against the 4.5 floor, so these three numbers cannot drift. */
  const tour = read("scripts/qa-podcast-player.mjs");
  assert.match(tour, /name: against\(getComputedStyle\(name\)\.color, ground\)/,
    "nothing measures the run's ink in the engine; a contrast claim nobody checks is a claim");
  assert.match(tour, /spine: against\(getComputedStyle\(entry, "::before"\)\.backgroundColor, ground\)/,
    "the spine takes the same derived ink and is not measured");
  assert.match(tour, /for \(const theme of ATMOSPHERES\) \{[\s\S]{0,600}?await evaluate\(LIST\)/,
    "the ink sweep runs in one atmosphere; the derivation has a polarity, so one proves a quarter of it");
});

test("the view toggle is a choice, is remembered, and is not a filter", () => {
  /* NEW CONTRACT · 2026-07-31. Two states, at the head of what they govern.
     Everything here is about the three ways this control could have gone wrong:
     by looking like the shelf's filter, by being unreachable from a keyboard,
     and by forgetting what the reader chose. */
  const room = read("src/renderer/components/Resources.tsx");
  const styles = read("src/renderer/styles.css");

  /* A RADIO GROUP, because the two states are mutually exclusive and
     exhaustive. Not `aria-pressed` — that is the shelf's idiom, and the shelf
     is the filter. */
  assert.match(room, /role="radiogroup"/);
  assert.match(room, /aria-label="How this chapter's listings are laid out"/);
  assert.match(room, /aria-checked=\{view === option\.id\}/);
  assert.doesNotMatch(
    room.slice(room.indexOf("* ── THE TOGGLE ·"), room.indexOf("/* The two footings")),
    /aria-pressed/,
    "the toggle is wearing the shelf's filter idiom");

  /* ONE TAB STOP, and the arrows move and choose. A room that can be nine
     hundred entries long must not spend two tab presses on how they are drawn. */
  assert.match(room, /tabIndex=\{view === option\.id \? 0 : -1\}/);
  assert.match(room, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(room, /moved\?\.\[\(at \+ step \+ VIEWS\.length\) % VIEWS\.length\]\?\.focus\(\)/,
    "the arrows move the selection without moving the focus, which is not a radio group");

  /* AND THE HEAD KEEPS ITS IDENTITY ACROSS THE SWITCH. Drawn as two branches,
     React unmounts the focused radio along with the head that held it and the
     reader is returned to the top of the document — measured. One element, two
     classes. */
  assert.doesNotMatch(room, /view === "list" \? \(\s*\n\s*<header/,
    "the head is two elements again; the switch will throw away the focused radio");

  /* THE APP'S VIEW-TAB IDIOM: ink and Law 2's seal, the same instrument
     `.podcast-view-tab` uses for the sheet's two views. */
  assert.match(styles, /\.resource-view-choice::after \{[^}]*background: var\(--study-gold\)/s,
    "the chosen view lost its seal");
  assert.match(styles, /\.resource-view-choice\[aria-checked="true"\] \{ color: var\(--text-primary\); \}/);
  /* And it survives a forced palette, where box-shadow and backgrounds do not. */
  assert.match(styles, /forced-colors[\s\S]*\.resource-view-choice\[aria-checked="true"\] \{[^}]*outline: 2px solid Highlight/,
    "the chosen view is stated only on channels a forced palette throws away");

  /* REMEMBERED, in settings, on the module — never in the component, because
     the margin mounts three of them and a `useState` would give one reader
     three answers. */
  const store = read("src/renderer/resource-view.ts");
  assert.match(store, /window\.api\.settings\.set\(\{ resourceView: next \}\)/);
  assert.match(store, /window\.api\.settings\.get\(\)/);
  assert.match(store, /if \(!result\.ok \|\| chosen\) return;/,
    "a settled read can overwrite a choice the reader already made by hand");
  assert.match(room, /useSyncExternalStore\(subscribeResourceView, readResourceView\)/);
  assert.doesNotMatch(room, /useState<ResourceView>/,
    "the view is component state again; three panels would hold three answers");

  /* THE MAIN PROCESS NORMALISES IT, and an unknown id is the shipped form
     rather than a refusal. */
  const main = read("src/electron/main.ts");
  assert.match(main, /const RESOURCE_VIEWS = new Set<AppSettingsSchema\["resourceView"\]>\(\["cards", "list"\]\);/);
  assert.match(main, /resourceView: normalizeResourceView\(settled\.resourceView\)/);
  assert.match(main, /resourceView: normalizeResourceView\(partial\.resourceView \?\? store\.store\.resourceView\)/);
  assert.match(main, /resourceView: "cards",/, "the shipped form is not the default");

  /* AND IT NEVER REACHES THE SHELF. The maintainer's instruction was explicit —
     "not for shelf but for listings" — and the rack has one form. */
  const shelf = room.slice(room.indexOf('className="resource-shelf-block"'), room.indexOf("{library && ("));
  assert.doesNotMatch(shelf, /ResourceViewToggle|resource-view-choice/,
    "the toggle reached the shelf; the rack is not part of this");
  assert.doesNotMatch(styles, /\.resource-shelf[^{]*\.resource-view/,
    "a rule is styling the toggle inside the shelf");
});

test("the transcript disclosure reaches the surfaces that show it, in a reader's language", () => {
  /* RESTATED 2026-07-31. This test held the TWO FOOTINGS — publisher-granted
     against public-feed — and asserted the distinction reached the reader,
     because docs/trusted-resource-permissions said it "must stay visible".
     The maintainer flattened the footing that day (see TRANSCRIPT_SOURCES):
     the app carries every publisher on one basis, approvals are sought before
     any public listing, and takedowns are honoured on request — none of which
     is a distinction a reading surface has to draw.

     What the reader is still owed is the half that was never about permission:
     these words were read by a machine, not by a person. That is what is
     asserted now, on both surfaces that say it. */
  const index = read("src/core/passage-index.ts");
  assert.match(index, /basis: TranscriptBasis/);
  assert.match(index, /transcriptBasis\(m\.id\) \?\? "carried"/,
    "the basis must be attached from the map, never read from the artifact");

  const room = read("src/renderer/components/Resources.tsx");
  assert.match(room, /className="taught-here-footing"/);
  assert.match(room, /machine-read from published audio/,
    "the room's colophon still says the transcripts are machine-read");

  const player = read("src/renderer/components/PodcastPlayer.tsx");
  assert.match(player, /className="podcast-episode-footing"/);
  assert.match(player, /machine-read from \$\{episode\.sourceName\}'s published audio/,
    "the episode still says whose audio it is and that a machine read it");
});

test("the walk is declared, finite, and never a radio", () => {
  const player = read("src/renderer/components/PodcastPlayer.tsx");
  const room = read("src/renderer/components/Resources.tsx");

  /* Its whole extent is stated before it is pressed: how many, that they are
     the fullest, how long altogether — and that it can be let go of.

     RESTATED 2026-07-30 (taste pass). This asserted the literal string
     "treatments, longest first, ${walkLength} in all", which held the FACTS in
     place and also froze the sentence that carried them: "12 treatments ·
     longest first · 5h 42m", three specifications in a colon chain with the
     reader's own decision nowhere in it. The facts are what this gate is for,
     so the facts are what it asserts — a count, an extent, and the one thing a
     five-hour button owes a reader that the spec line never said. */
  assert.match(room, /\$\{walkStops\.length\} fullest/,
    "the walk must say how many treatments it is about to play");
  assert.match(room, /about \$\{walkLength\}/,
    "the walk must declare its whole extent before it is pressed");
  assert.match(room, /Leave it whenever you like/,
    "a five-hour offer must say it can be left");
  /* Against the CODE rather than the file: the sentence this replaced is
     quoted in the prose above it, which is exactly the comment this codebase
     asks for. */
  assert.doesNotMatch(code("src/renderer/components/Resources.tsx"), /treatments · longest first/,
    "the inventory chain is back on the reading surface");
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
  /* ── SCOPED TO THE SHAPE · RESTATED 2026-07-31 ──────────────────────────
     This banned `localStorage|window.api.settings|onShapeChange` ANYWHERE IN
     THE FILE, which was a correct gate for exactly as long as the file held one
     preference. It now holds two, and they are opposite in kind: the discovery
     shape is the open question and must not be remembered; the CARDS-OR-LIST
     view is the reader's own settled choice and must be.

     A file-wide ban would have failed on the view and, worse, could have been
     "fixed" by moving the shape's persistence into a sibling module — which is
     the letter of the rule with none of its meaning. So the ban is now on what
     it was always about: nothing in this file may hand the SHAPE to storage,
     and no module may either. */
  const shape = room.slice(room.indexOf("const SHAPES ="), room.indexOf("/** What a press hands the transport"));
  assert.doesNotMatch(shape, /localStorage|window\.api\.settings|onShapeChange/,
    "the discovery shape is being remembered, which makes an open question look settled");
  assert.doesNotMatch(read("src/renderer/resource-view.ts"), /discovery|[Ss]hape/,
    "the shape is being persisted through the view's store, which is the ban's letter without its meaning");
  assert.doesNotMatch(read("src/electron/main.ts"), /discoveryShape/,
    "the shape reached the settings schema; it is an open question, not a preference");
  assert.doesNotMatch(room, /aria-label="Choose a layout"|<select/);
  /* And the CHOOSER the shape may not have is one the view does have, which is
     the clearest statement of the difference between them. */
  assert.match(room, /function ResourceViewToggle\(/);
  assert.doesNotMatch(room, /function DiscoveryShapePicker|shape-choice|data-shape-picker/,
    "the discovery shape grew a chooser; that makes an open question look answered");

  const vocabulary = read("scripts/qa-support/app-vocabulary.mjs");
  assert.match(vocabulary, /"data-discovery": \{[\s\S]*values: \["weight", "even", "spine", "digest"\]/);
});

/**
 * AN EPISODE IS THE SAME EPISODE WHATEVER SURFACE STARTED IT.
 *
 * The Listen room used to recognise the playing episode by `episode.id`, and
 * `id` is a key each surface builds for its own lists: the margin hands over
 * `entry.key`, the Listen room composes `sourceId:recordId`. Both are correct
 * locally and they do not agree, so pressing play on the reading page and then
 * walking to the Listen room showed nothing marked — no tinted row, no moving
 * bars — for the episode audibly playing.
 *
 * The identity that survives the trip is the publisher's: the source it came
 * from and the record it is. Both catalogues state the same `recordId` for the
 * same episode, which is what makes this hold across a restart too.
 */
test("an episode started from another surface is still recognised", () => {
  const fromTheMargin = {
    id: "five-minutes-church-history:2324:bref:v1/GEN.12.1",
    sourceId: "five-minutes-church-history",
    recordId: "five-minutes-church-history:podcast:2324",
  };
  const asTheRoomWouldName = {
    sourceId: "five-minutes-church-history",
    recordId: "five-minutes-church-history:podcast:2324",
  };

  assert.notEqual(
    fromTheMargin.id,
    `${asTheRoomWouldName.sourceId}:${asTheRoomWouldName.recordId}`,
    "the premise: two surfaces really do build different ids",
  );
  assert.ok(
    sameEpisode(fromTheMargin, asTheRoomWouldName.sourceId, asTheRoomWouldName.recordId),
    "and the room must recognise it anyway",
  );

  assert.ok(!sameEpisode(fromTheMargin, "bema", asTheRoomWouldName.recordId), "a different source is a different episode");
  assert.ok(!sameEpisode(fromTheMargin, fromTheMargin.sourceId, "other"), "a different record is a different episode");
  assert.ok(!sameEpisode(null, "any", "any"), "nothing playing matches nothing");
});
