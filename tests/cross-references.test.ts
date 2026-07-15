import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  queryCrossReferences,
  type CrossReferenceData,
} from "../src/core/cross-references/index.js";
import { loadOpenBibleCrossReferences } from "../src/host/cross-reference-loader.js";
import type { BookNameMap } from "../src/core/reference/types.js";

const bookNames: BookNameMap = {
  GEN: ["Genesis"], EXO: ["Exodus"], PSA: ["Psalms"], PRO: ["Proverbs"],
  ISA: ["Isaiah"], MAT: ["Matthew"], MRK: ["Mark"], LUK: ["Luke"],
  JHN: ["John"], ACT: ["Acts"], ROM: ["Romans"], "1CO": ["1 Corinthians"],
  GAL: ["Galatians"], EPH: ["Ephesians"], PHP: ["Philippians"],
  COL: ["Colossians"], "1TI": ["1 Timothy"], HEB: ["Hebrews"],
  "1JN": ["1 John"], REV: ["Revelation"],
};

function fixture(refs: CrossReferenceData["refs"]): CrossReferenceData {
  const edges = Object.values(refs).flat();
  const scores = edges.map((edge) => edge[1]);
  return {
    meta: {
      formatVersion: 1,
      id: "openbible-cross-references",
      name: "OpenBible Cross References",
      source: "fixture",
      sourceUrl: "https://www.openbible.info/labs/cross-references/",
      license: "CC-BY",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "OpenBible Cross References",
      snapshotDate: "2026-07-13",
      rowCount: edges.length,
      sourceVerseCount: Object.keys(refs).length,
      sourceBookCount: 1,
      targetRangeCount: edges.filter((edge) => edge[0].includes("-")).length,
      scoreMin: Math.min(...scores),
      scoreMax: Math.max(...scores),
      scoreSum: scores.reduce((sum, score) => sum + score, 0),
      rawSha256: "fixture",
      normalizedSha256: "fixture",
    },
    refs,
  };
}

test("verse query retains stored low/non-positive edges but presents the top ten positive matches", () => {
  const refs: CrossReferenceData["refs"] = {
    "JHN.3.16": [
      ["ROM.5.8", 100], ["1JN.4.9-1JN.4.10", 90], ["JHN.3.15", 80],
      ["JHN.3.16", 75], ["JHN.3.36", 70], ["JHN.6.40", 60],
      ["JHN.10.28", 50], ["ROM.8.32", 40], ["1TI.1.15-1TI.1.16", 30],
      ["EPH.2.4-EPH.2.5", 20], ["GAL.2.20", 10], ["COL.1.13", 1],
      ["ACT.1.1", 0], ["ACT.1.2", -4],
    ],
  };
  const data = fixture(refs);
  const result = queryCrossReferences(data, {
    book: "JHN", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16,
  }, bookNames);

  assert.equal(data.refs["JHN.3.16"]!.length, 14, "the installed graph is untouched");
  assert.equal(result.items.length, 10);
  assert.equal(result.totalCount, 11, "positive non-self targets are counted before the display cap");
  assert.equal(result.items[0]!.targetDisplay, "Romans 5:8");
  assert.equal(result.items[1]!.targetDisplay, "1 John 4:9–10", "destination ranges survive");
  assert.equal(result.items.some((item) => item.score <= 0), false);
  assert.equal(result.items.some((item) => item.targetDisplay === "John 3:16"), false, "self-overlap is hidden");
  assert.deepEqual(result.items[0]!.relationshipKinds, [], "unprovided relationship kinds are never fabricated");
});

test("passage query aggregates repeated targets and returns a compact top eight", () => {
  const data = fixture({
    "ACT.19.1": [["ACT.8.16", 4], ["ACT.8.12", 12]],
    "ACT.19.2": [["ACT.8.16", 5], ["ACT.2.4", 11]],
    "ACT.19.3": [["ACT.8.16", 3], ["ACT.6.6", 10]],
    "ACT.19.4": [["1CO.10.2", 9], ["ACT.1.5", 8]],
    "ACT.19.5": [["ACT.11.15-ACT.11.17", 7], ["GAL.3.27", 6]],
    "ACT.19.6": [["HEB.6.2", 5], ["EPH.1.13", 4]],
    "ACT.19.7": [["ROM.6.3", 3]],
  });
  const result = queryCrossReferences(data, {
    book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7,
  }, bookNames);

  assert.equal(result.scope, "passage");
  assert.equal(result.items.length, 8);
  assert.equal(result.totalCount, 11);
  assert.equal(result.items[0]!.targetDisplay, "Acts 8:16");
  assert.equal(result.items[0]!.supportingSourceCount, 3);
  assert.equal(result.items[0]!.supportingSourceBrefs.length, 3);
});

test("committed OpenBible artifact is complete, scored, ranged, and attributed", () => {
  const data = loadOpenBibleCrossReferences(
    resolve(import.meta.dirname, "../data/cross-references/openbible.jsonl"),
  );
  assert.equal(data.meta.id, "openbible-cross-references");
  assert.equal(data.meta.license, "CC-BY");
  assert.equal(data.meta.snapshotDate, "2026-07-13");
  assert.equal(data.meta.rowCount, 344_799);
  assert.equal(data.meta.sourceBookCount, 66);
  assert.equal(data.meta.targetRangeCount, 88_150);
  assert.equal(data.meta.scoreMin, -86);
  assert.equal(data.meta.scoreMax, 1283);

  const result = queryCrossReferences(data, {
    book: "JHN", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16,
  }, bookNames);
  assert.equal(result.items[0]!.targetDisplay, "Romans 5:8");
  assert.equal(result.items[0]!.score, 977);
});
