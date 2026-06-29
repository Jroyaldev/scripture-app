/**
 * M1 fold algorithm — whole-payload last-writer-wins (§4.2).
 * Folding MUST NOT order by wall-clock time (INV-8).
 * Pure, platform-agnostic (INV-18).
 */

import type {
  AppliedEvent,
  FoldedEntity,
  FoldResult,
  LibraryEvent,
} from "./types.js";

/**
 * Fold a list of events into current state per entity.
 * Algorithm:
 *   1. Dedupe by eventId
 *   2. Group by entityId
 *   3. Order by causal chain (baseEventId), then deterministic tie-break
 *   4. Apply whole-payload LWW, tracking tombstones and supersession
 */
export function foldEvents(events: LibraryEvent[]): FoldResult {
  // Step 1: Dedupe by eventId
  const deduped = dedupeByEventId(events);

  // Step 2: Group by entityId
  const groups = new Map<string, LibraryEvent[]>();
  for (const event of deduped) {
    let group = groups.get(event.entityId);
    if (!group) {
      group = [];
      groups.set(event.entityId, group);
    }
    group.push(event);
  }

  // Step 3 & 4: Order and fold each group
  const entities: FoldedEntity[] = [];
  const appliedIndex = new Map<string, AppliedEvent>();
  const now = new Date().toISOString();

  for (const [entityId, groupEvents] of groups) {
    const ordered = causalOrder(groupEvents);

    let activeEventId: string | null = null;
    let tombstoned = false;
    let activePayload: unknown = null;
    let activeEntityType = ordered[0]!.entityType;

    for (const e of ordered) {
      const appliedEntry: AppliedEvent = {
        event_id: e.eventId,
        entity_type: e.entityType,
        entity_id: e.entityId,
        device_id: e.deviceId,
        seq: e.seq,
        applied_at: now,
        status: "superseded",
        superseded_by: null,
        field_contested: null,
      };

      if (e.op === "delete") {
        tombstoned = true;
      } else if (e.op === "restore") {
        tombstoned = false;
      } else {
        // create | update | pin | unpin
        if (activeEventId !== null) {
          const prevEntry = appliedIndex.get(activeEventId);
          if (prevEntry) {
            prevEntry.status = "superseded";
            prevEntry.superseded_by = e.eventId;
          }
        }
        activeEventId = e.eventId;
        activePayload = e.payload;
        activeEntityType = e.entityType;
      }

      appliedIndex.set(e.eventId, appliedEntry);
    }

    // Mark final statuses
    if (tombstoned) {
      for (const e of ordered) {
        const entry = appliedIndex.get(e.eventId);
        if (entry) {
          entry.status = "tombstoned";
        }
      }
    } else if (activeEventId !== null) {
      const entry = appliedIndex.get(activeEventId);
      if (entry) {
        entry.status = "active";
      }

      entities.push({
        entityId,
        entityType: activeEntityType,
        payload: activePayload,
        activeEventId,
        tombstoned: false,
      });
    }
  }

  return { entities, appliedIndex };
}

function dedupeByEventId(events: LibraryEvent[]): LibraryEvent[] {
  const seen = new Set<string>();
  const result: LibraryEvent[] = [];
  for (const e of events) {
    if (!seen.has(e.eventId)) {
      seen.add(e.eventId);
      result.push(e);
    }
  }
  return result;
}

/**
 * Order events by causal chain, then deterministic tie-break (INV-8).
 * 1. Causal order via baseEventId (parent before child)
 * 2. For unresolved/sibling pairs: (deviceId, seq, eventId) ascending
 */
function causalOrder(events: LibraryEvent[]): LibraryEvent[] {
  // Build adjacency: baseEventId -> children
  const byId = new Map<string, LibraryEvent>();
  for (const e of events) {
    byId.set(e.eventId, e);
  }

  // Topological sort with deterministic tie-break
  const result: LibraryEvent[] = [];
  const visited = new Set<string>();

  // Sort all events by deterministic tie-break first
  const sorted = [...events].sort(deterministicCompare);

  function visit(event: LibraryEvent): void {
    if (visited.has(event.eventId)) return;

    // Visit parent first if it exists in this group
    if (event.baseEventId) {
      const parent = byId.get(event.baseEventId);
      if (parent && !visited.has(parent.eventId)) {
        visit(parent);
      }
    }

    visited.add(event.eventId);
    result.push(event);
  }

  for (const e of sorted) {
    visit(e);
  }

  return result;
}

function deterministicCompare(a: LibraryEvent, b: LibraryEvent): number {
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}
