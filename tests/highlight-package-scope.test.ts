import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeHighlightsToPackage } from "../src/renderer/utils/highlightPackageScope.js";

const records = [
  { id: "web-phrase", package: "web", char_start: 4, char_end: 18 },
  { id: "kjv-phrase", package: "kjv", char_start: 9, char_end: 27 },
  { id: "web-whole", package: "web", char_start: null, char_end: null },
];

test("WEB and KJV receive independent highlight layers", () => {
  assert.deepEqual(
    scopeHighlightsToPackage(records, "web").map((record) => record.id),
    ["web-phrase", "web-whole"],
  );
  assert.deepEqual(
    scopeHighlightsToPackage(records, "kjv").map((record) => record.id),
    ["kjv-phrase"],
  );
});

test("unknown packages never inherit another translation's offsets", () => {
  assert.deepEqual(scopeHighlightsToPackage(records, "other"), []);
});
