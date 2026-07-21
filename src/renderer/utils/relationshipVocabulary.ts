/**
 * One vocabulary for authored relationships. Every surface — the marking
 * palette, the radial, the inspector card, the overlap chooser, and the
 * canvas announcements — speaks from this table so a connection is always
 * the same thing by the same name.
 */
import type { ConnectionKind } from "../../core/annotations/types.js";

export interface RelationshipOption {
  id: ConnectionKind;
  label: string;
  description: string;
}

export const RELATIONSHIPS: readonly RelationshipOption[] = [
  { id: "link:parallel", label: "Parallelism", description: "The same thought, said again in other words." },
  { id: "link:contrast", label: "Contrast", description: "Two things set against each other." },
  { id: "link:echo", label: "Echo", description: "A word or phrase that returns from earlier." },
  { id: "mirror", label: "Mirror", description: "Paired halves that answer each other in order." },
  { id: "series", label: "Series", description: "A phrase or idea recurring as a refrain." },
  { id: "hinge", label: "Hinge", description: "One line that turns or weighs both sides." },
] as const;

export const RELATIONSHIP_LABELS: Readonly<Record<ConnectionKind, string>> = Object.fromEntries(
  RELATIONSHIPS.map((option) => [option.id, option.label]),
) as Record<ConnectionKind, string>;

export function relationshipLabel(kind: ConnectionKind): string {
  return RELATIONSHIP_LABELS[kind] ?? kind;
}

/** A connection joins phrases; count them the same way everywhere. */
export function phraseCount(count: number): string {
  return `${count} ${count === 1 ? "phrase" : "phrases"}`;
}
