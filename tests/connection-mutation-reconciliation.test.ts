import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionRecord } from "../src/core/annotations/types.js";
import {
  connectionRecordVersion,
  needsLocalConnectionReconciliation,
  reconcileCreatedConnection,
  reconcileDeletedConnection,
  reconcileUpdatedConnection,
} from "../src/renderer/utils/connectionMutationReconciliation.js";

function connection(label: string, verses = [1, 2], activeEventId = `event:${label}`): ConnectionRecord {
  return {
    id: "connection-1",
    format_version: 1,
    activeEventId,
    kind: "series",
    label,
    anchors: verses.map((verse) => ({
      book: "PSA",
      chapter: 1,
      verse_start: verse,
      verse_end: verse,
    })),
  };
}

test("reload outcomes distinguish failed and pending projection from supersession", () => {
  assert.equal(needsLocalConnectionReconciliation("failed", {}), true);
  assert.equal(needsLocalConnectionReconciliation("applied", { projection: "pending" }), true);
  assert.equal(needsLocalConnectionReconciliation("applied", { warning: "index recovery pending" }), true);
  assert.equal(needsLocalConnectionReconciliation("applied", { projection: "current" }), false);
  assert.equal(needsLocalConnectionReconciliation("superseded", { projection: "pending" }), false);
  assert.equal(needsLocalConnectionReconciliation("superseded", { warning: "index recovery pending" }), false);
});

test("historical create replay never replaces an already visible entity version", () => {
  const historical = connection("Created");
  const newer = connection("Updated later", [1, 3], "event:newer");
  const current = [newer];
  assert.equal(reconcileCreatedConnection(current, historical), current);
  assert.deepEqual(reconcileCreatedConnection([], historical), [historical]);
});

test("update fallback advances only the exact base version", () => {
  const base = connection("Base");
  const committed = connection("Committed", [1, 2], "event:committed");
  const newer = connection("Newer query", [2, 4], "event:newer");
  assert.deepEqual(
    reconcileUpdatedConnection([base], committed, connectionRecordVersion(base)),
    [committed],
  );
  const visibleNewer = [newer];
  assert.equal(
    reconcileUpdatedConnection(visibleNewer, committed, connectionRecordVersion(base)),
    visibleNewer,
  );
  assert.equal(reconcileUpdatedConnection([base], committed, undefined)[0], base);
  const sameContentNewerEvent = connection("Base", [1, 2], "event:same-content-newer");
  const sameContentVisible = [sameContentNewerEvent];
  assert.equal(
    reconcileUpdatedConnection(sameContentVisible, committed, connectionRecordVersion(base)),
    sameContentVisible,
    "event identity, not payload equality, must protect a newer same-content fold",
  );
});

test("delete fallback removes only the exact base version", () => {
  const base = connection("Base");
  const newer = connection("Newer query", [1, 2], "event:newer");
  assert.deepEqual(reconcileDeletedConnection([base], base.id, connectionRecordVersion(base)), []);
  const visibleNewer = [newer];
  assert.equal(
    reconcileDeletedConnection(visibleNewer, base.id, connectionRecordVersion(base)),
    visibleNewer,
  );
});
