/**
 * Quire C·4 — "Connections shows connections."
 *
 * The headline finding this file exists for: the Connections tab was showing
 * the edition's cross-references, and its count was `crossRefs.items.length`
 * plus the app's note-derived cross-references, with no authored connection in
 * it at all. "A connection in this app is a thing you made… Putting the
 * edition's list under the word Connections makes third-party data wear the
 * reader's own hand, which is the same class of error as unmarked licensed
 * prose."
 *
 * The count is the part that regresses, because it regresses by someone
 * "restoring" a number. So the first test here holds it shut.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type {
  ConnectionKind,
  ConnectionRecordV2,
} from "../src/core/annotations/types.js";
import {
  CONNECTION_MEMBERS_SHOWN,
  connectionMemberViews,
} from "../src/renderer/components/LivingMargin.js";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");
const margin = read("src/renderer/components/LivingMargin.tsx");
const page = read("src/renderer/components/ScripturePage.tsx");
const css = read("src/renderer/styles.css");

/** The panel's own source, from its first component to the next surface. */
const panelSource = margin.slice(
  margin.indexOf("function ConnectionBlock("),
  margin.indexOf("function IntentOverview("),
);

function anchor(chapter: number, verse: number, position = 1): ConnectionRecordV2["anchors"][number] {
  return {
    book: "ACT",
    chapter,
    verse_start: verse,
    verse_end: verse,
    exact: {
      format_version: 1,
      layer: "backbone-token:v1",
      occurrences: [{ verse, position }],
    },
  };
}

function connection(
  kind: ConnectionKind,
  anchors: ConnectionRecordV2["anchors"],
): ConnectionRecordV2 {
  return {
    id: `conn-${kind}`,
    format_version: 2,
    kind,
    label: `${kind} label`,
    observation: "A sentence that belongs to a note, never to the panel.",
    anchors,
    activeEventId: "event-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("the Connections tab's count is authored connections and cannot include cross-references", () => {
  // Was: `const connectionCount = (crossRefs?.items.length ?? 0) + noteConnectionCount;`
  const countLine = margin.match(/^\s*const connectionCount = .*$/m)?.[0] ?? "";
  assert.match(countLine, /passageConnections\.length/);
  assert.doesNotMatch(countLine, /crossRef/i);
  assert.doesNotMatch(margin, /const noteConnectionCount/);

  // The whole derivation, not just its last line: the scope, the filter and the
  // sort must all read off authored connections, with no cross-reference list
  // anywhere between them.
  const derivation = margin.slice(
    margin.indexOf("const passageConnectionScope"),
    margin.indexOf("const connectionCount"),
  );
  assert.ok(derivation.length > 0, "the authored-connection derivation is missing");
  assert.match(derivation, /authoredConnections/);
  assert.doesNotMatch(derivation, /crossRefs/);
  assert.doesNotMatch(derivation, /suggestedCrossRefs/);

  // And the tab reads that count and no other. Quire C·4: counts are "seal when
  // the count is yours" — every connection is authored, so this one always is.
  const tabCount = margin.slice(margin.indexOf("const tabCount ="), margin.indexOf("const clearSelection"));
  const connectionsCount = tabCount.match(/^.*tab === "connections".*$/m)?.[0] ?? "";
  assert.match(connectionsCount, /connectionCount/);
  assert.doesNotMatch(connectionsCount, /crossRef/i);
});

test("no cross-reference list of any provenance renders inside the Connections tab", () => {
  const panels = [...margin.matchAll(/id="margin-connections-panel"[\s\S]*?<\/section>/g)]
    .map((match) => match[0]);
  assert.equal(panels.length, 3, "every scope state draws the Connections tab");
  for (const panel of panels) {
    assert.doesNotMatch(panel, /CrossRefsBlock/);
    assert.doesNotMatch(panel, /NoteCrossRefsBlock/);
    assert.doesNotMatch(panel, /crossRefs/);
    assert.match(panel, /<ConnectionsPanel/);
  }
  // Both blocks were briefly exported for a surface to adopt. Overview
  // re-implemented them on C4·2's compact row instead, and was right to: their
  // heading was mono, which C4·6 strikes, and `.crossref-row` was one of the
  // five reference-row treatments C4·2 collapses into two. So they are deleted,
  // and restoring either would ship a retired drawing back into a corrected
  // surface — the same shape of regression as restoring the count.
  assert.doesNotMatch(margin, /function CrossRefsBlock|function NoteCrossRefsBlock|function CrossReferenceRow/);
  // The retired copy, in the forms it could only take if it were rendered
  // again — the record of why it went names it, and that note must survive.
  assert.doesNotMatch(margin, /aria-label="Related verses"|>Related verses</);
  assert.doesNotMatch(margin, />Connections in your library</);
  // The edition's list is still drawn, still named as the edition's.
  assert.match(margin, /title="Cross-references"/);
  assert.match(margin, /· edition/);
});

test("the reader's connections are listed in exactly one place, and it does not move the tab row", () => {
  // The `.margin-authored-connections` strip stood between the scope bar and
  // the tab row: "Your connections", a count, and a button per connection
  // carrying its label. It was the Connections tab's own dataset in a second
  // treatment over a wider scope — the finding restated one band higher — and
  // it rendered on `subjectConnections.length > 0`, so the tab row moved the
  // moment a chapter gained its first connection. §C4·1: navigation should not
  // move. Neither the markup nor its rules may come back.
  assert.doesNotMatch(margin, /className="margin-authored-connections/);
  assert.doesNotMatch(css, /^\.margin-authored-connections/m);

  // Nothing renders between the frame header and the study content, so the tab
  // row's y cannot depend on how much of the reader's own work a chapter holds.
  const betweenHeaderAndContent = margin
    .slice(
      margin.lastIndexOf("</header>"),
      margin.indexOf("<div className={`margin-study-content"),
    )
    // The record of why the strip went names it, so read the markup, not the note.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
  assert.ok(betweenHeaderAndContent.length > 0, "the frame header and study content are not where expected");
  assert.doesNotMatch(betweenHeaderAndContent, /subjectConnections|passageConnections/);

  // And a connection's label is not drawn anywhere: the type and the members
  // are the whole claim, and any prose about it is a note.
  assert.doesNotMatch(panelSource, /connection\.label/);
});

test("Echo is the only type with a direction: the earliest member is the source and sits first", () => {
  // Authored latest-first — the reader selected the returning phrase.
  const echo = connection("link:echo", [anchor(19, 6), anchor(2, 38)]);
  const members = connectionMemberViews(echo, [], "ACT", "bsb");
  assert.deepEqual(members.map((member) => member.position), ["2:38", "19:6"]);
  assert.equal(members[0]!.role, "source");
  assert.equal(members[0]!.ink, "ink");
  assert.equal(members[1]!.ink, "ink-2");
});

test("a Mirror's order is its content, and the panel never re-sorts its members", () => {
  // Canonical order would put 19:2 first; a mirror must be read as authored.
  const mirror = connection("mirror", [anchor(19, 6), anchor(19, 2)]);
  const members = connectionMemberViews(mirror, [], "ACT", "bsb");
  assert.deepEqual(members.map((member) => member.position), ["19:6", "19:2"]);
  assert.match(panelSource, /data-member-order=\{connection\.kind === "mirror" \? "authored" : "text"\}/);
});

test("a Hinge spends ink on its pivot and ink-2 on its span, whichever comes first in the text", () => {
  // Pivot authored first, but standing later in the text.
  const hinge = connection("hinge", [anchor(19, 6), anchor(19, 2)]);
  const members = connectionMemberViews(hinge, [], "ACT", "bsb");
  // Listed in text order …
  assert.deepEqual(members.map((member) => member.position), ["19:2", "19:6"]);
  // … while the ink follows the role, not the position.
  assert.deepEqual(members.map((member) => member.role), ["span", "pivot"]);
  assert.deepEqual(members.map((member) => member.ink), ["ink-2", "ink"]);
});

test("both members of a Contrast carry equal weight: neither is quoted in ink-2", () => {
  const contrast = connection("link:contrast", [anchor(19, 3), anchor(19, 5)]);
  const members = connectionMemberViews(contrast, [], "ACT", "bsb");
  assert.deepEqual(members.map((member) => member.position), ["19:3", "19:5"]);
  assert.deepEqual(members.map((member) => member.ink), ["ink", "ink"]);
});

test("Parallelism lists peers in text order and Series is the type that reaches n more", () => {
  const parallel = connection("link:parallel", [anchor(19, 5), anchor(19, 2)]);
  assert.deepEqual(
    connectionMemberViews(parallel, [], "ACT", "bsb").map((member) => member.position),
    ["19:2", "19:5"],
  );

  const series = connection("series", [
    anchor(19, 2, 1),
    anchor(19, 2, 4),
    anchor(19, 6),
    anchor(19, 11),
  ]);
  const members = connectionMemberViews(series, [], "ACT", "bsb");
  assert.equal(members.length, 4);
  assert.equal(CONNECTION_MEMBERS_SHOWN, 3);
  assert.match(panelSource, /const shown = members\.slice\(0, CONNECTION_MEMBERS_SHOWN\)/);
  assert.match(panelSource, /const overflow = members\.length - shown\.length/);
  assert.match(panelSource, /\{overflow\} more/);
});

test("a member quotes its own wording, and an unrouted connection keeps its position markers", () => {
  const echo = connection("link:echo", [anchor(2, 38), anchor(19, 2)]);
  const quoted = connectionMemberViews(echo, [
    { book: "ACT", chapter: 2, verse_start: 38, verse_end: 38, fragments: [
      { verse: 38, char_start: 0, char_end: 10, quote: "and you will receive the gift" },
    ] },
    { book: "ACT", chapter: 19, verse_start: 2, verse_end: 2, fragments: [
      { verse: 2, char_start: 0, char_end: 10, quote: "Did you receive the Holy Spirit" },
    ] },
  ], "ACT", "bsb");
  assert.deepEqual(quoted.map((member) => member.quote), [
    "and you will receive the gift",
    "Did you receive the Holy Spirit",
  ]);

  // "A connection with no thread drawn is still listed, with its position
  // markers only — an unrouted connection is not a missing one."
  const unrouted = connectionMemberViews(echo, [], "ACT", "bsb");
  assert.deepEqual(unrouted.map((member) => member.quote), ["", ""]);
  assert.deepEqual(unrouted.map((member) => member.position), ["2:38", "19:2"]);
  assert.match(panelSource, /data-thread=\{drawn \? "drawn" : "undrawn"\}/);
  assert.match(panelSource, /is-unprojected/);

  // Members are drawn as the one shared quoted reference row, never a sixth
  // treatment of their own, and only that variant appears in this list.
  assert.match(panelSource, /className="study-ref-row study-ref-row--quoted margin-connection-member"/);
  assert.doesNotMatch(panelSource, /study-ref-row--compact/);
  // One position column per block, borrowed by every member, so the wording all
  // starts at the same x — a mirror's second member sets flush with its first.
  // It grows above its 26px reserve rather than clipping, because a clipped
  // reference establishes a scroll container and synthesises its baseline from
  // the border box, which lifts it clear of the phrase beside it (ruling 4·6).
  assert.match(css, /\.margin-connection-row \{[^}]*grid-template-columns: minmax\(26px, auto\) minmax\(0, 1fr\)/);
  assert.match(css, /\.margin-connection-list \.margin-connection-member \{[^}]*grid-template-columns: subgrid/);
  assert.doesNotMatch(css.slice(css.indexOf(".margin-connections {"), css.indexOf(".connection-card {")), /overflow: hidden|text-overflow/);
});

test("a connection carries no sentence of its own, and its type is a word rather than a hue", () => {
  // The type and the members are the whole claim; prose about a connection is
  // a note, so neither the authored label nor its observation renders here.
  assert.doesNotMatch(panelSource, /connection\.observation/);
  assert.doesNotMatch(panelSource, /connection\.label/);
  assert.match(panelSource, /RELATIONSHIP_LABELS\[connection\.kind\]/);
  // Six kinds, one ink. No stylesheet rule may key colour off the kind.
  assert.doesNotMatch(css, /\[data-connection-kind=/);
  assert.match(css, /\.margin-connection-type \{[^}]*color: var\(--study-gold\)/);
});

test("the panel row's outline is inset, never a border, so no row reflows on hover", () => {
  const row = css.slice(css.indexOf(".margin-connection-row {"), css.indexOf(".margin-connection-row-head"));
  assert.match(row, /box-shadow: inset 0 0 0 1\.5px transparent;/);
  assert.match(row, /border: 0;/);
  assert.match(row, /\.margin-connection-row:hover,\s*\.margin-connection-row\[data-thread-hover\]/);
  assert.match(row, /box-shadow: inset 0 0 0 1\.5px var\(--study-gold-focus\)/);
  // Padding is unconditional: the hover state adds ink, never geometry.
  assert.doesNotMatch(row, /:hover \{[^}]*padding/);
  // Rev 04 §4: focus is full-strength seal outside the shape.
  assert.match(row, /:focus-visible \{\s*outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/);
});

test("no mono on this surface — tabular figures do the aligning", () => {
  const block = css.slice(css.indexOf(".margin-connections {"), css.indexOf(".connection-card {"));
  assert.ok(block.length > 0, "the connections panel rules are missing");
  assert.doesNotMatch(block, /--font-mono|monospace/);
  assert.match(block, /\.margin-connection-position \.study-ref-row-ref \{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(block, /\.margin-connection-arity \{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(block, /\.margin-connection-count \{[^}]*font-variant-numeric: tabular-nums/);
});

test("verbs are words in a footer, and empty is never blank", () => {
  assert.match(panelSource, /className="margin-connection-footer"/);
  assert.match(panelSource, /Connect a phrase/);
  assert.match(panelSource, /Threads shown/);
  const footer = css.slice(css.indexOf(".margin-connection-footer {"), css.indexOf(".connection-card {"));
  assert.doesNotMatch(footer, /border-radius/);
  assert.doesNotMatch(footer, /border: 1px/);
  // One sentence naming what is absent, then the nearest true thing.
  assert.match(panelSource, /You have not connected any phrases here\./);
  assert.match(panelSource, /Elsewhere in this chapter/);
  assert.match(margin, /elsewhereConnections/);
});

test("attending from a panel row reuses the one shared least-distance scroll", () => {
  // Rev 04 §5: clicking a member, its gutter tick, or its row in the
  // Connections tab is one behaviour. The panel must not grow a second one.
  assert.doesNotMatch(panelSource, /scrollIntoView|scrollTo\(/);
  assert.match(page, /const handleSelectAuthoredConnection[\s\S]{0,320}?await handleSelectConnection\(connection, focusInspector\)/);
  const sharedScroll = page.slice(
    page.indexOf("const scrollAttendedConnectionIntoView"),
    page.indexOf("const handleSelectConnection"),
  );
  assert.ok(sharedScroll.length > 0, "the shared attend scroll is missing");
  assert.match(sharedScroll, /leastScrollForMembers\(\{/);
});

test("the panel and the thread are one object, tied without redrawing the thread", () => {
  // Hover a thread, its row takes the same inset seal outline: the panel reads
  // the canvas's own `data-connection-id` / `data-connection-tick` marks.
  assert.match(panelSource, /\[data-connection-id\], \[data-connection-tick\]/);
  // Hover a row, its thread thickens: one custom property set on that
  // connection's own group and removed again — never a rule, never a
  // coordinate. Stroke width grows about the fixed centre datum.
  assert.match(panelSource, /setProperty\("--connection-route-selected-width"/);
  assert.match(panelSource, /removeProperty\("--connection-route-selected-width"\)/);
  assert.match(margin, /const CONNECTION_THREAD_HOVER_STROKE = CONNECTION_ROUTE_SELECTED_STROKE \+ 1/);
});
