import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ConnectionRecordV2 } from "../src/core/annotations/types.js";
import {
  compareConnectionsCanonical,
  canonicalConnectionAnchors,
} from "../src/core/annotations/connection-order.js";
import { selectionProjectionRoundTrips } from "../src/core/annotations/occurrence-alignment.js";
import { connectionDraftExitActions } from "../src/renderer/utils/connectionDraftLifecycle.js";
import { reduceMarginWorkspace } from "../src/renderer/utils/marginWorkspace.js";

const repoRoot = process.cwd();

function connection(
  id: string,
  anchors: Array<{ verse: number; position: number }>,
): ConnectionRecordV2 {
  return {
    id,
    format_version: 2,
    kind: "series",
    label: id,
    observation: "",
    anchors: anchors.map(({ verse, position }) => ({
      book: "ACT",
      chapter: 19,
      verse_start: verse,
      verse_end: verse,
      exact: {
        format_version: 1,
        layer: "backbone-token:v1",
        occurrences: [{ verse, position }],
      },
    })),
    activeEventId: `event-${id}`,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

test("active-package connection capture refuses lexical widening", () => {
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 2, char_start: 37, quote: "Holy Spirit" }],
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
  ), false);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 3, char_start: 55, quote: "baptism" }],
    [{ verse: 3, char_start: 55, quote: "baptism" }],
  ), true);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
  ), true);
});

test("passage connections and their anchors ignore creation and authoring order", () => {
  const laterCreated = connection("01-later-created", [{ verse: 6, position: 8 }, { verse: 2, position: 7 }]);
  const earlierCreated = connection("99-earlier-created", [{ verse: 3, position: 9 }]);
  const sameVerseEarlierWord = connection("50-same-verse", [{ verse: 3, position: 2 }]);
  assert.deepEqual(
    [laterCreated, earlierCreated, sameVerseEarlierWord]
      .sort(compareConnectionsCanonical)
      .map((item) => item.id),
    ["01-later-created", "50-same-verse", "99-earlier-created"],
  );
  assert.deepEqual(
    canonicalConnectionAnchors(laterCreated).map((anchor) => anchor.verse_start),
    [2, 6],
  );
  const crossPassage = connection("00-cross-passage", [{ verse: 18, position: 1 }, { verse: 3, position: 1 }]);
  crossPassage.anchors[0] = { ...crossPassage.anchors[0]!, chapter: 18 };
  assert.deepEqual(
    [crossPassage, sameVerseEarlierWord]
      .sort((left, right) => compareConnectionsCanonical(left, right, {
        book: "ACT",
        chapter: 19,
        verseStart: 1,
        verseEnd: 10,
      }))
      .map((item) => item.id),
    ["00-cross-passage", "50-same-verse"],
  );
});

test("draft exits never invent save or timer behavior", () => {
  assert.deepEqual(connectionDraftExitActions(1), ["discard", "keep-editing"]);
  assert.deepEqual(connectionDraftExitActions(2), ["save", "discard", "keep-editing"]);
  assert.deepEqual(connectionDraftExitActions(4), ["save", "discard", "keep-editing"]);
});

test("Study and Research are persistent bounded workspaces", () => {
  assert.equal(reduceMarginWorkspace("study", { type: "open-research" }), "research");
  assert.equal(reduceMarginWorkspace("research", {
    type: "select",
    workspace: "study",
    hasResearch: true,
  }), "study");
  assert.equal(reduceMarginWorkspace("study", {
    type: "select",
    workspace: "research",
    hasResearch: true,
  }), "research");
  assert.equal(reduceMarginWorkspace("research", { type: "close-research" }), "study");
  assert.equal(reduceMarginWorkspace("study", {
    type: "select",
    workspace: "research",
    hasResearch: false,
  }), "study");
});

test("desktop integration owns one draft rail, exit controller, attention scroll, and APG tabs", () => {
  const marking = readFileSync(join(repoRoot, "src/renderer/components/MarkingSurface.tsx"), "utf8");
  const scripture = readFileSync(join(repoRoot, "src/renderer/components/ScripturePage.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src/renderer/components/LivingMargin.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src/renderer/app.tsx"), "utf8");
  const main = readFileSync(join(repoRoot, "src/electron/main.ts"), "utf8");
  assert.match(marking, /Select more text to keep adding\./);
  assert.match(marking, />Save connection<\/button>/);
  assert.match(marking, />Cancel draft<\/button>/);
  assert.match(marking, /requestDraftExit\("escape"\)/);
  assert.doesNotMatch(marking, /inactivity|countdown|auto.?save/i);
  assert.match(scripture, /scrollIntoView\(\{[\s\S]{0,180}block: "center"/);
  assert.match(scripture, /onSelectAuthoredConnection=\{handleSelectAuthoredConnection\}/);
  assert.match(app, /requestExit\("view-change"\)/);
  assert.match(app, /requestExit\("library-change"\)/);
  assert.match(app, /requestExit\("window-close"\)/);
  assert.match(app, /appWindow\.resolveCloseRequest\(proceed\)/);
  assert.match(main, /win\.on\("close", \(event\) => \{[\s\S]*event\.preventDefault\(\)[\s\S]*app-window-close-requested/);
  assert.doesNotMatch(marking, /beforeunload/);
  assert.match(margin, /role="tablist" aria-label="Study workspaces"/);
  assert.match(margin, /aria-controls=\{`margin-\$\{workspace\}-workspace`\}/);
  assert.match(margin, /workspaceScrollPositionsRef/);
});
