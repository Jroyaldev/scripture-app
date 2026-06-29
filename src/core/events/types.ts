/**
 * LibraryEvent envelope and related types — pure, platform-agnostic (INV-18).
 * All structured authored logs use this one envelope (§4.2).
 */

export type EntityType =
  | "highlight"
  | "fact"
  | "thread"
  | "source"
  | "pluginSetting"
  | "librarySetting"
  | "noteMeta";

export type EventOp =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "pin"
  | "unpin";

export type ActorKind = "user" | "system" | "plugin";

export type Actor = {
  kind: ActorKind;
  id?: string;
};

export type LibraryEvent<TPayload = unknown> = {
  eventId: string;
  schemaVersion: number;
  entityType: EntityType;
  entityId: string;
  op: EventOp;
  actor: Actor;
  deviceId: string;
  seq: number;
  createdAt: string;
  baseEventId?: string;
  payload: TPayload;
};

/** Status of an applied event after folding. */
export type EventStatus = "active" | "superseded" | "tombstoned";

export type AppliedEvent = {
  event_id: string;
  entity_type: string;
  entity_id: string;
  device_id: string;
  seq: number;
  applied_at: string;
  status: EventStatus;
  superseded_by: string | null;
  field_contested: string | null;
};

/** The result of folding an entity's events. */
export type FoldedEntity = {
  entityId: string;
  entityType: EntityType;
  payload: unknown;
  activeEventId: string;
  tombstoned: boolean;
};

/** The full result of folding all events. */
export type FoldResult = {
  entities: FoldedEntity[];
  appliedIndex: Map<string, AppliedEvent>;
};
