import assert from "node:assert/strict";
import { test } from "node:test";
import { foldEvents } from "../src/core/events/fold.js";
import type { LibraryEvent } from "../src/core/events/types.js";

type HighlightPayload = {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  color: string;
};

function makeEvent(overrides: Partial<LibraryEvent<HighlightPayload>> & { eventId: string }): LibraryEvent<HighlightPayload> {
  return {
    eventId: overrides.eventId,
    schemaVersion: 1,
    entityType: "highlight",
    entityId: "hl_01",
    op: "create",
    actor: { kind: "user" },
    deviceId: "device-a",
    seq: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: { book: "JHN", chapter: 3, verse_start: 16, verse_end: 16, color: "yellow" },
    ...overrides,
  };
}

test("create -> exactly one active entity with correct payload; appliedIndex status 'active'", () => {
  const createEvent = makeEvent({ eventId: "evt_create" });

  const result = foldEvents([createEvent]);

  assert.equal(result.entities.length, 1);
  const entity = result.entities[0]!;
  assert.equal(entity.entityId, "hl_01");
  assert.equal(entity.entityType, "highlight");
  assert.deepEqual(entity.payload, createEvent.payload);
  assert.equal(entity.activeEventId, "evt_create");
  assert.equal(entity.tombstoned, false);

  const applied = result.appliedIndex.get("evt_create");
  assert.ok(applied);
  assert.equal(applied.status, "active");
  assert.equal(applied.superseded_by, null);
});

test("create + delete(baseEventId=create) -> no active entity; both events still present (INV-7); status reflects tombstoned", () => {
  const createEvent = makeEvent({ eventId: "evt_create", seq: 0 });
  const deleteEvent = makeEvent({
    eventId: "evt_delete",
    op: "delete",
    baseEventId: "evt_create",
    seq: 1,
    payload: createEvent.payload,
  });

  const result = foldEvents([createEvent, deleteEvent]);

  assert.equal(result.entities.length, 0);

  // Append-only: both events remain in the appliedIndex (INV-7).
  assert.equal(result.appliedIndex.size, 2);
  const createApplied = result.appliedIndex.get("evt_create");
  const deleteApplied = result.appliedIndex.get("evt_delete");
  assert.ok(createApplied);
  assert.ok(deleteApplied);
  assert.equal(createApplied.status, "tombstoned");
  assert.equal(deleteApplied.status, "tombstoned");
});

test("create + delete + restore -> entity active again with the ORIGINAL create payload carried forward", () => {
  const createEvent = makeEvent({ eventId: "evt_create", seq: 0 });
  const deleteEvent = makeEvent({
    eventId: "evt_delete",
    op: "delete",
    baseEventId: "evt_create",
    seq: 1,
    payload: createEvent.payload,
  });
  const restoreEvent = makeEvent({
    eventId: "evt_restore",
    op: "restore",
    baseEventId: "evt_delete",
    seq: 2,
    payload: createEvent.payload,
  });

  const result = foldEvents([createEvent, deleteEvent, restoreEvent]);

  assert.equal(result.entities.length, 1);
  const entity = result.entities[0]!;
  assert.equal(entity.tombstoned, false);
  assert.equal(entity.activeEventId, "evt_create");
  assert.deepEqual(entity.payload, createEvent.payload);

  const restoreApplied = result.appliedIndex.get("evt_restore");
  assert.ok(restoreApplied);
  assert.equal(restoreApplied.status, "superseded");
});

test("create + update(baseEventId=create, new payload) -> one entity with UPDATED payload (whole-payload LWW); create status 'superseded'", () => {
  const createEvent = makeEvent({ eventId: "evt_create", seq: 0 });
  const updatedPayload: HighlightPayload = {
    book: "JHN",
    chapter: 3,
    verse_start: 16,
    verse_end: 17,
    color: "green",
  };
  const updateEvent = makeEvent({
    eventId: "evt_update",
    op: "update",
    baseEventId: "evt_create",
    seq: 1,
    payload: updatedPayload,
  });

  const result = foldEvents([createEvent, updateEvent]);

  assert.equal(result.entities.length, 1);
  const entity = result.entities[0]!;
  assert.deepEqual(entity.payload, updatedPayload);
  assert.equal(entity.activeEventId, "evt_update");

  const createApplied = result.appliedIndex.get("evt_create");
  const updateApplied = result.appliedIndex.get("evt_update");
  assert.ok(createApplied);
  assert.ok(updateApplied);
  assert.equal(createApplied.status, "superseded");
  assert.equal(createApplied.superseded_by, "evt_update");
  assert.equal(updateApplied.status, "active");
});

test("sibling tie-break is deterministic and order-independent (INV-8)", () => {
  // Two sibling events (no baseEventId chain), differing deviceId/seq.
  const eventA = makeEvent({
    eventId: "evt_a",
    deviceId: "device-a",
    seq: 5,
    payload: { book: "JHN", chapter: 3, verse_start: 16, verse_end: 16, color: "yellow" },
  });
  const eventB = makeEvent({
    eventId: "evt_b",
    deviceId: "device-b",
    seq: 3,
    payload: { book: "JHN", chapter: 3, verse_start: 16, verse_end: 16, color: "blue" },
  });

  const forward = foldEvents([eventA, eventB]);
  const reversed = foldEvents([eventB, eventA]);

  assert.equal(forward.entities.length, 1);
  assert.equal(reversed.entities.length, 1);

  // deterministicCompare orders by deviceId first; "device-a" < "device-b",
  // so device-a is visited first and device-b (visited later) wins as the
  // final active event (last writer in the deterministic walk).
  const forwardWinner = forward.entities[0]!.activeEventId;
  const reversedWinner = reversed.entities[0]!.activeEventId;

  assert.equal(forwardWinner, "evt_b");
  assert.equal(reversedWinner, "evt_b");
  assert.equal(forwardWinner, reversedWinner);
});

test("exact-duplicate event (same eventId twice) dedupes to one entity / one appliedIndex entry", () => {
  const createEvent = makeEvent({ eventId: "evt_create" });
  const duplicate = makeEvent({ eventId: "evt_create" });

  const result = foldEvents([createEvent, duplicate]);

  assert.equal(result.entities.length, 1);
  assert.equal(result.appliedIndex.size, 1);
  assert.equal(result.appliedIndex.get("evt_create")?.status, "active");
});
