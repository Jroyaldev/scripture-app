import type { ConnectionRecord } from "../../core/annotations/types.js";

export type MarginReloadStatus = "applied" | "failed" | "superseded";
export type ConnectionMutationUiOutcome = "complete" | "committed-pending" | "conflict" | "failed";

export interface ConnectionMutationAcknowledgement {
  projection?: "current" | "rebuilt" | "pending";
  warning?: string;
}

/**
 * A projection warning means Substrate is authoritative but the SQLite read
 * model may still answer with the pre-command row. A superseded reload is
 * different: a newer request owns renderer state, so the older mutation must
 * never install a local fallback over it.
 */
export function needsLocalConnectionReconciliation(
  reloadStatus: MarginReloadStatus,
  acknowledgement: ConnectionMutationAcknowledgement,
): boolean {
  if (reloadStatus === "superseded") return false;
  return reloadStatus === "failed"
    || acknowledgement.projection === "pending"
    || acknowledgement.warning != null;
}

export function isConnectionProjectionPending(
  acknowledgement: ConnectionMutationAcknowledgement,
): boolean {
  return acknowledgement.projection === "pending" || acknowledgement.warning != null;
}

/** Authoritative folded-event version used for optimistic renderer guards. */
export function connectionRecordVersion(connection: ConnectionRecord): string {
  return connection.activeEventId;
}

/** Whole authored content fingerprint; excludes the Derived active event id. */
export function connectionRecordFingerprint(connection: ConnectionRecord): string {
  return JSON.stringify([
    connection.id,
    connection.format_version,
    connection.kind,
    connection.label,
    connection.format_version === 2 ? connection.observation : null,
    connection.anchors,
  ]);
}

export function reconcileCreatedConnection(
  current: ConnectionRecord[],
  authoritative: ConnectionRecord,
): ConnectionRecord[] {
  const existing = current.find((connection) => connection.id === authoritative.id);
  // A same-command replay can return the historical create after an update.
  // Existing material is therefore never replaced by the create payload.
  if (existing) return current;
  return [...current, authoritative];
}

export function reconcileUpdatedConnection(
  current: ConnectionRecord[],
  authoritative: ConnectionRecord,
  expectedBaseEventId: string | undefined,
): ConnectionRecord[] {
  if (!expectedBaseEventId) return current;
  const index = current.findIndex((connection) => connection.id === authoritative.id);
  if (index < 0) return current;
  const visible = current[index]!;
  const visibleVersion = connectionRecordVersion(visible);
  if (visibleVersion === connectionRecordVersion(authoritative)) return current;
  // Only advance the exact version the command was authored against. If a
  // newer query has already installed B, replaying historical A cannot regress
  // it to the broker's original response.
  if (visibleVersion !== expectedBaseEventId) return current;
  const next = [...current];
  next[index] = authoritative;
  return next;
}

export function reconcileDeletedConnection(
  current: ConnectionRecord[],
  connectionId: string,
  expectedBaseEventId: string | undefined,
): ConnectionRecord[] {
  if (!expectedBaseEventId) return current;
  const visible = current.find((connection) => connection.id === connectionId);
  if (!visible || connectionRecordVersion(visible) !== expectedBaseEventId) {
    return current;
  }
  return current.filter((connection) => connection.id !== connectionId);
}
