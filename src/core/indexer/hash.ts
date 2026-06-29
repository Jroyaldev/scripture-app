/**
 * rebuild_hash canonicalization (§4.5) — pure, platform-agnostic (INV-18).
 * SHA-256 over the canonicalized logical fold.
 * EXCLUDES: notes_fts, embeddings, cache, logs (INV-10).
 */

import type {
  NoteRecord,
  AnchorRecord,
  EdgeRecord,
  HighlightRecord,
  FactRecord,
} from "./types.js";
import type { FoldedEntity } from "../events/types.js";

export type LogicalState = {
  entities: FoldedEntity[];
  notes: NoteRecord[];
  anchors: AnchorRecord[];
  edges: EdgeRecord[];
  highlights: HighlightRecord[];
  facts: FactRecord[];
};

/**
 * Canonicalize logical state into a deterministic JSON string.
 * Rules from §4.5:
 * - Include semantic fields only; exclude rowids, file paths, build timestamps
 * - Strings: Unicode NFC
 * - Timestamps: RFC3339 UTC, 'Z' suffix
 * - Floats: fixed decimals (confidence: 4 places)
 * - Arrays: sorted by id (ULID) ascending
 * - Object keys: sorted lexicographically
 * - Serialize: JSON, no insignificant whitespace, keys sorted
 */
export function canonicalize(state: LogicalState): string {
  const canonical = {
    anchors: sortById(state.anchors.map(canonicalizeAnchor)),
    edges: sortByComposite(state.edges.map(canonicalizeEdge)),
    entities: sortById(state.entities.map(canonicalizeEntity)),
    facts: sortById(state.facts.map(canonicalizeFact)),
    highlights: sortById(state.highlights.map(canonicalizeHighlight)),
    notes: sortById(state.notes.map(canonicalizeNote)),
  };

  return stableStringify(canonical);
}

function canonicalizeNote(n: NoteRecord): Record<string, unknown> {
  return sortKeys({
    id: nfc(n.id),
    title: nfc(n.title),
    type: nfc(n.type),
    created: normalizeTimestamp(n.created),
    modified: normalizeTimestamp(n.modified),
    body_text: nfc(n.body_text),
  });
}

function canonicalizeAnchor(a: AnchorRecord): Record<string, unknown> {
  return sortKeys({
    id: nfc(a.id),
    src_kind: nfc(a.src_kind),
    src_id: nfc(a.src_id),
    corpus: nfc(a.corpus),
    book: nfc(a.book),
    start_ch: a.start_ch,
    start_v: a.start_v,
    end_ch: a.end_ch,
    end_v: a.end_v,
    provenance: nfc(a.provenance),
  });
}

function canonicalizeEdge(e: EdgeRecord): Record<string, unknown> {
  return sortKeys({
    src_id: nfc(e.src_id),
    dst_id: nfc(e.dst_id),
    kind: nfc(e.kind),
    provenance: nfc(e.provenance),
  });
}

function canonicalizeHighlight(h: HighlightRecord): Record<string, unknown> {
  return sortKeys({
    id: nfc(h.id),
    book: nfc(h.book),
    chapter: h.chapter,
    verse_start: h.verse_start,
    verse_end: h.verse_end,
    package: nfc(h.package),
    char_start: h.char_start,
    char_end: h.char_end,
    color: nfc(h.color),
    kind: nfc(h.kind),
    note_id: h.note_id ? nfc(h.note_id) : null,
    deleted: h.deleted,
  });
}

function canonicalizeFact(f: FactRecord): Record<string, unknown> {
  return sortKeys({
    id: nfc(f.id),
    assertion: nfc(f.assertion),
    from_claim: f.from_claim ? nfc(f.from_claim) : null,
    user_note: f.user_note ? nfc(f.user_note) : null,
    deleted: f.deleted,
  });
}

function canonicalizeEntity(e: FoldedEntity): Record<string, unknown> {
  return sortKeys({
    entityId: nfc(e.entityId),
    entityType: nfc(e.entityType),
    payload: canonicalizePayload(e.payload),
    activeEventId: nfc(e.activeEventId),
    tombstoned: e.tombstoned,
  });
}

function canonicalizePayload(p: unknown): unknown {
  if (p === null || p === undefined) return null;
  if (typeof p === "string") return nfc(p);
  if (typeof p === "number") return p;
  if (typeof p === "boolean") return p;
  if (Array.isArray(p)) return p.map(canonicalizePayload);
  if (typeof p === "object") {
    const result: Record<string, unknown> = {};
    const keys = Object.keys(p as Record<string, unknown>).sort();
    for (const key of keys) {
      result[key] = canonicalizePayload((p as Record<string, unknown>)[key]);
    }
    return result;
  }
  return p;
}

function nfc(s: string): string {
  return s.normalize("NFC");
}

function normalizeTimestamp(ts: string): string {
  if (!ts) return ts;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return nfc(ts);
    return d.toISOString();
  } catch {
    return nfc(ts);
  }
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function sortById<T extends Record<string, unknown>>(
  arr: T[],
): T[] {
  return [...arr].sort((a, b) => {
    const aId = String(a["id"] ?? a["entityId"] ?? "");
    const bId = String(b["id"] ?? b["entityId"] ?? "");
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

function sortByComposite(
  arr: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...arr].sort((a, b) => {
    const aKey = `${a["src_id"]}|${a["dst_id"]}|${a["kind"]}`;
    const bKey = `${b["src_id"]}|${b["dst_id"]}|${b["kind"]}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

/**
 * Stable JSON stringify with sorted keys.
 */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>).sort();
      for (const k of keys) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Compute SHA-256 hash. This is an I/O interface — the host provides the implementation.
 */
export type HashFunction = (data: string) => string;
