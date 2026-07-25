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

/**
 * A slice between two anchors, each of which must occur EXACTLY ONCE.
 *
 * Every assertion in this file that reads a region rather than the whole file
 * depends on its anchors resolving where it thinks they do, and a wrong anchor
 * fails in the passing direction: `indexOf` silently takes the first match, so
 * the slice quietly becomes some other agent's code and the assertions inside
 * it go on succeeding — or, worse, succeed against a neighbour's work.
 *
 * This file was bitten twice by that family. An early tab-row guard anchored on
 * `</header>`, which is not unique in LivingMargin, and sliced from
 * `TrustedResourcesBlock`'s header rather than the margin frame's; and an end
 * anchor of `.connection-card {` was not unique in the stylesheet. Both
 * resolved correctly at the time, which is the whole problem — right by luck,
 * with nothing to say when the luck ran out.
 *
 * Those sentences are deliberately in the past tense and carry no counts. An
 * earlier draft of this comment stated how many times each anchor occurred and
 * claimed the guard below was "the last test in this file". Both were live
 * claims about files four agents are editing, and a comment is an assertion
 * with no test, so it fails silently by default: the counts would have rotted
 * without a symptom, and the positional claim was false the moment anything was
 * appended. The invariant is asserted below instead of described here.
 */
function between(source: string, start: string, end: string, label: string): string {
  const startCount = source.split(start).length - 1;
  const endCount = source.split(end).length - 1;
  assert.equal(startCount, 1, `${label}: start anchor ${JSON.stringify(start)} occurs ${startCount}×, not once`);
  assert.equal(endCount, 1, `${label}: end anchor ${JSON.stringify(end)} occurs ${endCount}×, not once`);
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(to > from, `${label}: anchors resolve out of order`);
  return source.slice(from, to);
}

/** The panel's own source, from its first component to the next surface. */
const panelSource = between(
  margin,
  "function ConnectionBlock(",
  "function IntentOverview(",
  "the connections panel",
);

/** The panel's own rules. The end anchor takes a newline: `.connection-card {`
 *  alone also matches a descendant selector later in the sheet. */
const panelCss = between(css, ".margin-connections {", "\n.connection-card {", "the connections panel's rules");

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
  const derivation = between(margin, "const passageConnectionScope", "const connectionCount", "the count's derivation");
  assert.ok(derivation.length > 0, "the authored-connection derivation is missing");
  assert.match(derivation, /authoredConnections/);
  assert.doesNotMatch(derivation, /crossRefs/);
  assert.doesNotMatch(derivation, /suggestedCrossRefs/);

  // And the tab reads that count and no other. Quire C·4: counts are "seal when
  // the count is yours" — every connection is authored, so this one always is.
  const tabCount = between(margin, "const tabCount =", "const clearSelection", "the tab count");
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
  // `</header>` occurs four times, so the region is anchored on the unique
  // node that opens it instead of on the frame header's closing tag.
  const betweenHeaderAndContent = between(
    margin,
    "{connectionInspectorOpen && (",
    "<div className={`margin-study-content",
    "between the scope bar and the tab row",
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
  assert.doesNotMatch(panelCss, /overflow: hidden|text-overflow/);
});

test("the block's accessible name says everything the ink and the cap leave out", () => {
  // The row is one button, so `aria-label` overrides its children — anything
  // the name omits is not merely quieter, it is gone. Nothing in this block
  // carries an sr-only mark that the name could silently swallow, and that is
  // asserted rather than assumed: a provenance span added inside the button
  // later would be suppressed by the label without any visible symptom.
  assert.doesNotMatch(panelSource, /sr-only|MarginEntryWhy/);

  // Provenance is stated once, by the region, because it does not vary here:
  // "every connection is authored, so every connection is seal" (Rev 04 §8).
  // A list whose provenance varied would have to mark every row.
  assert.match(panelSource, /<section className="margin-connections" aria-label="Your connections">/);
  assert.match(panelSource, /\{connections\.length\} · yours/);

  // The name lists every member, not just the CONNECTION_MEMBERS_SHOWN the
  // panel draws: `n more` is a space constraint, and a name has no space.
  assert.match(panelSource, /members\.map\(memberName\)/);
  assert.doesNotMatch(panelSource, /shown\.map\(memberName\)/);
});

test("a connection carries no sentence of its own, and its type is a word rather than a hue", () => {
  // The type and the members are the whole claim; prose about a connection is
  // a note, so neither the authored label nor its observation renders here.
  assert.doesNotMatch(panelSource, /connection\.observation/);
  assert.doesNotMatch(panelSource, /connection\.label/);
  assert.match(panelSource, /RELATIONSHIP_LABELS\[connection\.kind\]/);
  // Six kinds, one ink. No stylesheet rule may key colour off the kind.
  assert.doesNotMatch(css, /\[data-connection-kind=/);
  assert.match(css, /\.margin-connection-type \{[^}]*color: var\(--accent-seal\)/);
});

test("the panel row's outline is inset, never a border, so no row reflows on hover", () => {
  const row = between(css, ".margin-connection-row {", ".margin-connection-row-head", "the panel row's rules");
  assert.match(row, /box-shadow: inset 0 0 0 1\.5px transparent;/);
  assert.match(row, /border: 0;/);
  assert.match(row, /\.margin-connection-row:hover,\s*\.margin-connection-row\[data-thread-hover\]/);
  // The attend tint reads its alpha off the seal rather than out of
  // `--study-gold-focus`. That token is a focus token by name and is being
  // retired; this rule is a hover mark, not a focus indicator, so naming it
  // here would have got the rule swept with the real washed rings — and the
  // sweep's answer, full strength, is wrong for a tint. C·4 §3 draws it at
  // rgba(150,104,74,.3), which is 30% of the seal, and which follows the
  // atmosphere where a literal could not.
  assert.match(row, /box-shadow: inset 0 0 0 1\.5px color-mix\(in srgb, var\(--accent-seal\) 30%, transparent\)/);
  assert.doesNotMatch(row, /--study-gold-focus\)/);
  // Padding is unconditional: the hover state adds ink, never geometry.
  assert.doesNotMatch(row, /:hover \{[^}]*padding/);
  // Rev 04 §4: focus is full-strength seal outside the shape.
  // §4·4 · full strength, outside the shape, and no focus token at all: a
  // focus ring at reduced alpha is the defect the ruling names.
  assert.match(row, /:focus-visible \{\s*outline: 2px solid var\(--accent-seal\);\s*outline-offset: 2px;/);
  // Nothing in this panel may depend on the retiring token, in either form.
  const block = panelCss.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.doesNotMatch(block, /var\(--study-gold[a-z-]*\)/);
});

test("no mono on this surface — tabular figures do the aligning", () => {
  const block = panelCss;
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
  const footer = between(css, ".margin-connection-footer {", "\n.connection-card {", "the panel footer's rules");
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
  const sharedScroll = between(page, "const scrollAttendedConnectionIntoView", "const handleSelectConnection", "the shared attend scroll");
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

/* --- The QA tours, which npm test cannot run -------------------------------

   The Electron tours are repaired by source inspection and executed by hand,
   so anything statically decidable about them belongs in the gate that does
   run. Two whole classes of tour defect fail *silently* in the tours' own
   terms — a `querySelector` that matches nothing returns a falsy value the
   probe cheerfully reports, and a never-matching regex sits under a loop that
   never runs — and both are decidable from source.

   c4-overview built the first two of these for the notes and overview
   surfaces, deliberately scoped to the class tokens they own. These are the
   same guards over the connections panel, plus two the class check cannot
   see: this panel's probes carry a child combinator and an attribute
   selector, and a correct class token in the wrong shape is exactly the
   residual the tours were meant to catch.
--------------------------------------------------------------------------- */

const tours = [
  "scripts/qa-living-margin-tour.mjs",
  "scripts/qa-study-overlays-tour.mjs",
  // The third tour is the one that seeds real connections, so it is the only
  // one whose connections probes can return a non-empty result today.
  "scripts/qa-desktop-reading-control.mjs",
].map((path) => ({ path, source: read(path) }));

/** Class tokens this panel owns. Other agents' selectors are theirs to check. */
const OWNED_CLASS = /^margin-connections?(?:-|$)/;

test("every selector the tours query on the connections panel is one it renders", () => {
  const rendered = new Set<string>();
  for (const match of margin.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const token of (match[1] ?? match[2] ?? "").split(/[\s${}?:()"'+]+/)) {
      if (token) rendered.add(token.replace(/^\./, ""));
    }
  }
  const queried = new Set<string>();
  for (const { source } of tours) {
    for (const match of source.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      if (OWNED_CLASS.test(match[1]!)) queried.add(match[1]!);
    }
  }
  // A floor, so the sweep cannot pass by finding nothing to sweep.
  assert.ok(queried.size >= 8, `expected the tours to probe this panel, found ${queried.size}`);
  for (const token of queried) {
    assert.ok(rendered.has(token), `the tours query .${token}, which LivingMargin never renders`);
  }
});

test("the tours' structural and attribute probes match the shape the panel renders", () => {
  // A class-token check cannot see either of these, and both fail silently:
  // the probe returns zero and the tour reports "no rows" rather than "wrong
  // selector". They are the residual the tours exist to catch, so the half
  // that is decidable from source is decided here.

  // 1 · The child combinator. `rows` counts the in-passage list only, by
  // relying on the elsewhere list being wrapped a level deeper. If that
  // wrapper ever goes, `.margin-connections > .margin-connection-list` starts
  // silently including the chapter's other connections in the scope count.
  assert.ok(
    tours.some(({ source }) => source.includes(".margin-connections > .margin-connection-list")),
    "no tour probes the in-passage list, so this guard has nothing to protect",
  );
  const lists = [...panelSource.matchAll(/className="margin-connection-list"/g)];
  assert.equal(lists.length, 2, "one list in passage, one elsewhere — a third breaks the row counts");
  assert.match(
    panelSource,
    /<div className="margin-connection-elsewhere">[\s\S]*?<div className="margin-connection-list">/,
    "the elsewhere list must stay wrapped, or the in-passage probe absorbs it",
  );
  assert.ok(
    panelSource.indexOf('className="margin-connection-list"')
      < panelSource.indexOf('className="margin-connection-elsewhere"'),
    "the in-passage list is drawn first; the tours read the first one as the scope's",
  );

  // 2 · The attribute selector. The identity-ordering probe clicks
  // `.margin-connection-row[data-connection-id="…"]`, which is the assertion
  // that survives the panel no longer drawing a connection's label.
  assert.ok(
    tours.some(({ source }) => /\.margin-connection-row\[data-connection-id=/.test(source)),
    "no tour drives a connection row by identity",
  );
  assert.match(panelSource, /data-connection-id=\{connection\.id\}/);
});

test("no regex in the tours is escaped for the wrong context", () => {
  // `\\s` is correct inside an `evaluate()` template and broken in an outer-JS
  // regex literal, where it demands a literal backslash. Such a regex can
  // never match, and it sits under a loop that therefore never runs. Strip the
  // templates, then refuse the escape anywhere an assertion could use it.
  let checked = 0;
  for (const { path, source } of tours) {
    const outer = source.replace(/`(?:[^`\\]|\\[\s\S])*`/g, " ");
    for (const line of outer.split("\n")) {
      if (!line.includes("assert.")) continue;
      checked += 1;
      assert.doesNotMatch(
        line,
        /\/[^/\n]*\\\\[sdwSDWbB.][^/\n]*\//,
        `${path} has a regex escaped for the template context: ${line.trim()}`,
      );
    }
  }
  assert.ok(checked >= 20, `expected to check the tours' assertions, checked ${checked}`);
});

test("every region this file reads is sliced through a uniqueness-checked anchor", () => {
  // The clause this whole file's guards keep re-learning: an assertion whose
  // passing condition is "found something" needs a second assertion that it
  // looked in the RIGHT place. A wrong anchor and an empty result fail
  // identically — silently, in the passing direction — so `between()` refuses
  // an anchor that occurs more than once, and this test refuses a slice that
  // bypasses `between()`.
  const self = read("tests/connections-tab-contract.test.ts");
  // The whole file, not the part above this test. An earlier draft swept only
  // what preceded itself, to dodge a self-match — and that scoping was itself
  // a hole: a raw slice added BELOW this test escaped the guard entirely, which
  // a mutation confirmed before this was rewritten. The patterns are built from
  // fragments instead, so the literals they forbid never appear in this file
  // and the sweep can cover all of it without excluding anything by position.
  const body = self.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const RAW_SLICE = new RegExp("\\.slice\\(\\s*\\w+\\." + "(?:last)?" + "[iI]ndexOf" + "\\(", "g");
  const POSITIONAL = new RegExp("\\." + "last" + "[iI]ndexOf" + "\\(", "g");

  assert.equal([...body.matchAll(RAW_SLICE)].length, 0,
    "a region is sliced on a raw indexOf, which cannot know it resolved correctly");
  assert.equal([...body.matchAll(POSITIONAL)].length, 0,
    "lastIndexOf picks a match by position, which is not a uniqueness argument");

  // And a floor, so this cannot pass by there being no regions to check —
  // which would be the very failure it exists to catch.
  const checked = [...body.matchAll(/\bbetween\(/g)].length;
  assert.ok(checked >= 8, `expected this file to slice through between(), found ${checked}`);
});
