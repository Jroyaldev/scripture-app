import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  connectionRowLayoutSignature,
  encodeConnectionTickMemberIds,
  parseConnectionTickMemberIds,
  planConnectionTickLanes,
  reconcileConnectionRows,
  type ConnectionRowLayoutInput,
} from "../src/renderer/utils/connectionRowLayout.js";

test("noncolliding connection ticks retain their desired positions", () => {
  const packed = planConnectionTickLanes([
    { id: "c", side: "right", focusY: 120 },
    { id: "a", side: "right", focusY: 30 },
    { id: "b", side: "right", focusY: 75 },
    { id: "left", side: "left", focusY: 30 },
  ], 144, 45, 2);
  const right = packed
    .filter((lane) => lane.side === "right")
    .sort((left, right) => left.top - right.top);

  assert.deepEqual(right.map((lane) => lane.memberIds), [["a"], ["b"], ["c"]]);
  assert.deepEqual(right.map((lane) => lane.top), [18, 63, 108]);
  assert.equal(
    packed.find((lane) => lane.memberIds[0] === "left")?.top,
    18,
    "the opposite rail must retain its independent preferred position",
  );
  assert.ok(right.every((lane, index) => index === 0 || lane.top - right[index - 1]!.top >= 45));
});

test("connection tick overflow groups instead of compressing hit intervals", () => {
  const packed = planConnectionTickLanes([
    { id: "a", side: "right", focusY: 30 },
    { id: "b", side: "right", focusY: 30 },
    { id: "c", side: "right", focusY: 30 },
  ], 80, 45, 10);

  assert.equal(packed.length, 1);
  assert.deepEqual(packed[0]?.memberIds, ["a", "b", "c"]);
  assert.equal(packed[0]?.top, 18);
});

test("connection tick grouping is input-order independent and represents every id exactly once", () => {
  const inputs = [
    { id: "e", side: "right" as const, focusY: 120 },
    { id: "a", side: "right" as const, focusY: 30 },
    { id: "d", side: "right" as const, focusY: 33 },
    { id: "b", side: "right" as const, focusY: 31 },
    { id: "c", side: "right" as const, focusY: 32 },
  ];
  const forward = planConnectionTickLanes(inputs, 144, 45, 10);
  const reversed = planConnectionTickLanes([...inputs].reverse(), 144, 45, 10);

  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.map((lane) => lane.memberIds), [["a", "b", "c", "d"], ["e"]]);
  assert.deepEqual(forward.map((lane) => lane.top), [19.5, 108]);
  assert.deepEqual(forward.flatMap((lane) => lane.memberIds).sort(), ["a", "b", "c", "d", "e"]);
  assert.ok(forward.every((lane, index) => index === 0 || lane.top - forward[index - 1]!.top >= 45));
});

test("dense local collisions aggregate without fanning out across a tall chapter rail", () => {
  const dense = Array.from({ length: 12 }, (_, index) => ({
    id: `dense-${index.toString().padStart(2, "0")}`,
    side: "right" as const,
    focusY: 200 + index,
  }));
  const packed = planConnectionTickLanes([
    { id: "single-before", side: "right", focusY: 80 },
    ...dense,
    { id: "single-after", side: "right", focusY: 620 },
  ], 800, 45, 10);

  assert.deepEqual(packed.map((lane) => lane.memberIds), [
    ["single-before"],
    dense.map((item) => item.id),
    ["single-after"],
  ]);
  assert.deepEqual(packed.map((lane) => lane.top), [68, 193.5, 608]);
  assert.ok(
    packed[1]!.top >= dense[0]!.focusY - 12
      && packed[1]!.top <= dense.at(-1)!.focusY - 12,
    "the aggregate must remain inside the dense cluster's desired span",
  );
  assert.equal(packed[0]!.top, 80 - 12, "the preceding single must not be displaced");
  assert.equal(packed[2]!.top, 620 - 12, "the following single must not be displaced");
});

test("overflow merges the closest adjacent reading positions before distant ones", () => {
  const packed = planConnectionTickLanes([
    { id: "far", side: "right", focusY: 100 },
    { id: "near-2", side: "right", focusY: 2 },
    { id: "near-0", side: "right", focusY: 0 },
    { id: "near-1", side: "right", focusY: 1 },
  ], 100, 45, 10);

  assert.deepEqual(packed.map((lane) => lane.memberIds), [
    ["near-0", "near-1", "near-2"],
    ["far"],
  ]);
  assert.ok(packed[1]!.top - packed[0]!.top >= 45);
});

test("group member attributes round-trip safely and malformed values fail closed", () => {
  assert.deepEqual(parseConnectionTickMemberIds(encodeConnectionTickMemberIds(["a", "b:c"])), ["a", "b:c"]);
  assert.deepEqual(parseConnectionTickMemberIds("not-json"), []);
  assert.deepEqual(parseConnectionTickMemberIds('{"id":"a"}'), []);
  assert.deepEqual(parseConnectionTickMemberIds('["a",7]'), []);
});

test("all supported rail heights conserve ids and keep same-side effective hit intervals disjoint", () => {
  const heights = [0, 20, 44, 45, 80, 120, 400];
  const modes = [
    { separation: 25, inset: 2, hitHeight: 24 },
    { separation: 45, inset: 10, hitHeight: 44 },
  ] as const;

  for (const height of heights) {
    for (let count = 0; count <= 20; count += 1) {
      const inputs = Array.from({ length: count }, (_, index) => ({
        id: `connection-${index}`,
        side: index % 3 === 0 ? "left" as const : "right" as const,
        focusY: (index * 17 + (index % 4) * 3) % Math.max(1, height),
      }));
      for (const mode of modes) {
        const lanes = planConnectionTickLanes(
          [...inputs].reverse(),
          height,
          mode.separation,
          mode.inset,
        );
        assert.deepEqual(
          lanes.flatMap((lane) => lane.memberIds).sort(),
          inputs.map((item) => item.id).sort(),
          `lost or duplicated an id at height=${height}, count=${count}`,
        );
        assert.ok(lanes.every((lane) => lane.memberIds.length > 0));
        for (const side of ["left", "right"] as const) {
          const sideLanes = lanes.filter((lane) => lane.side === side).sort((a, b) => a.top - b.top);
          for (let index = 1; index < sideLanes.length; index += 1) {
            assert.ok(
              sideLanes[index]!.top - sideLanes[index - 1]!.top >= mode.separation,
              `${side} targets overlap at height=${height}, count=${count}, hit=${mode.hitHeight}`,
            );
          }
        }
      }
    }
  }
});

test("aggregate ticks stay neutral, open the bounded chooser, and remain focus-restorable", () => {
  const underlay = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/ConnectionUnderlay.tsx"),
    "utf8",
  );
  const scripture = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/ScripturePage.tsx"),
    "utf8",
  );
  const styles = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/styles.css"),
    "utf8",
  );

  assert.match(underlay, /const tickLanes = planConnectionTickLanes\(/);
  assert.match(underlay, /data-connection-tick-members=\{aggregate \? encodeConnectionTickMemberIds\(lane\.memberIds\)/);
  assert.match(underlay, /if \(aggregate\) \{[\s\S]{0,900}onChooseConnections\(records,[\s\S]{0,240}return;/);
  assert.match(underlay, /if \(aggregate\) clearPreview\(false\);[\s\S]{0,180}else previewPointerIntent/);
  assert.match(scripture, /function findConnectionTickControl\([\s\S]{0,520}parseConnectionTickMemberIds/);
  assert.match(scripture, /onChooseConnections=\{handleChooseConnections\}/);
  assert.match(scripture, /setConnectionWordChooser\(\{[\s\S]{0,120}anchorRect,[\s\S]{0,80}hits,[\s\S]{0,120}aggregateMemberIds:/);
  assert.match(scripture, /className="connection-word-choice"[\s\S]{0,100}data-connection-id=\{hit\.connection\.id\}/);
  assert.match(styles, /\.connection-tick-aggregate \.connection-tick-dash \{[\s\S]{0,160}width: 13px;/);
});

interface MockRow {
  verse: number;
  top: number;
  height: number;
  text: string;
}

function inputFor(row: MockRow, fontRevision = 0): ConnectionRowLayoutInput<MockRow> {
  return {
    verse: row.verse,
    element: row,
    signature: connectionRowLayoutSignature({
      verse: row.verse,
      width: "640.000",
      height: row.height.toFixed(3),
      textBox: `32.000,620.000,0.000,${row.height.toFixed(3)}`,
      numberBox: "0.000,24.000,0.000,18.000",
      text: row.text,
      font: "17px Literata",
      lineHeight: "28px",
      letterSpacing: "normal",
      wordSpacing: "0px",
      textIndent: "0px",
      textTransform: "none",
      direction: "ltr",
      whiteSpace: "normal",
      fontKerning: "auto",
      fontFeatureSettings: "normal",
      fontVariationSettings: "normal",
      fontRevision,
    }),
  };
}

test("one locally reflowed verse does not repeat the chapter word-Range scan", () => {
  const rows = Array.from({ length: 40 }, (_, index): MockRow => ({
    verse: index + 1,
    top: index * 28,
    height: 28,
    text: `Verse ${index + 1} has stable measured words.`,
  }));
  let measured: number[] = [];
  const measure = (input: ConnectionRowLayoutInput<MockRow>): string => {
    // In the renderer this callback is measureVerseRowGeometry, the only
    // chapter-block callback that constructs a word Range.
    measured.push(input.verse);
    return `local-ranges:${input.verse}:${input.element.text}`;
  };

  const initial = reconcileConnectionRows(new Map(), rows.map((row) => inputFor(row)), measure);
  assert.equal(initial.rows.size, 40);
  assert.deepEqual(measured, Array.from({ length: 40 }, (_, index) => index + 1));

  measured = [];
  for (const row of rows) row.top += 56;
  rows[16]!.height = 56;
  rows[16]!.text += " Added words wrap onto one extra line.";
  const localized = reconcileConnectionRows(
    initial.rows,
    rows.map((row) => inputFor(row)),
    measure,
  );

  assert.deepEqual(measured, [17], "translated unchanged rows must reuse their local word rectangles");
  assert.deepEqual([...localized.remeasuredVerses], [17]);
  assert.equal(localized.rows.get(18), initial.rows.get(18), "row after the reflow must be translated, not rescanned");

  measured = [];
  const afterFontLoad = reconcileConnectionRows(
    localized.rows,
    rows.map((row) => inputFor(row, 1)),
    measure,
  );
  assert.equal(measured.length, 40, "font settlement must invalidate every glyph measurement");
  assert.equal(afterFontLoad.remeasuredVerses.size, 40);
});

test("ConnectionUnderlay wires the row-local cache ahead of word Range measurement", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/ConnectionUnderlay.tsx"),
    "utf8",
  );
  const reconcile = source.indexOf("const reconciledRows = reconcileConnectionRows(");
  const rowRange = source.indexOf("function measureVerseRowGeometry(");
  const anchorRange = source.indexOf("function rangeRectsForAnchor(");

  assert.ok(rowRange >= 0 && reconcile > rowRange && anchorRange > rowRange);
  assert.match(source, /cachedLayout\?\.rows \?\? new Map/);
  assert.match(source, /remeasuredVerses\.has\(verse\)/);
  assert.match(source, /reprojectAnchorFragments/);
  assert.doesNotMatch(source, /container\.querySelectorAll<HTMLElement>\("\.verse-text-span"\)/);
  assert.doesNotMatch(source, /invalidateMeasurement: invalidateLayout/);
  assert.match(source, /onFontsSettled: handleFontsSettled/);
});
