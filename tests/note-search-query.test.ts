import assert from "node:assert/strict";
import { test } from "node:test";
import { toFts5PlainQuery } from "../src/core/search/note-search-query.js";

test("plain note search neutralizes FTS syntax in Scripture references", () => {
  assert.equal(toFts5PlainQuery("John 3:16"), '"John" AND "3" AND "16"');
});

test("plain note search keeps natural words literal and stable", () => {
  assert.equal(toFts5PlainQuery("love is love patient"), '"love" AND "is" AND "patient"');
  assert.equal(toFts5PlainQuery(""), "");
});
