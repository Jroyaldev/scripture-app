/**
 * Read-time migrations for RETIRED fields on durable connection anchors.
 *
 * These run on read paths only. There are TWO, and both must strip the same
 * names or the set drifts between them:
 *
 *   1. `validateConnectionRecord` (./index.ts) — the append-only history walk
 *      and folding, i.e. what cold boot uses.
 *   2. `hydrateExactConnectionAnchor` (../../host/sqlite.ts) — the derived
 *      projection, which stores each anchor's lossless JSON verbatim and so
 *      still holds the retired field in rows built by an older build. A
 *      projection whose marker still matches the log is NOT rebuilt, so those
 *      rows can persist indefinitely; this path is not merely transitional.
 *
 * They deliberately do NOT run on the authoring path
 * (`validateNewConnectionRecord`), so a retired field can still be read out of
 * existing history but can never be written into new history. This is a
 * migration for bytes that already exist, not a permanent tolerance.
 *
 * Every retired field is enumerated BY NAME below. This is not, and must never
 * become, a blanket "ignore unknown fields" step: an anchor carrying any key
 * outside the enumeration still reaches `validateBackboneTokenAnchor` intact
 * and is still refused there.
 */

/**
 * `selection_shape` — retired format_version 2 anchor sidecar.
 *
 * WHAT IT WAS. While the backbone-token anchor was being built, a v2 anchor
 * could carry a `selection_shape` object as a sibling of its canonical `exact`
 * selector:
 *
 *     "selection_shape": {
 *       "format_version": 1,
 *       "content_occurrences": [{ "verse": 2, "position": 6 },
 *                               { "verse": 2, "position": 7 }],
 *       "own_occurrences": [],
 *       "own_subclasses": [],
 *       "lead_function_words": 0,
 *       "trail_function_words": 0
 *     }
 *
 * It recorded which of the selected tokens the author treated as CONTENT words
 * and how many FUNCTION words led or trailed the selection — a refinement of
 * how a selection was shaped, not a statement of what the selection IS.
 *
 * WHY IT IS DROPPED AT READ TIME. The writer stopped emitting the field without
 * a migration, so libraries authored against the older build still carry it and
 * now refuse to cold boot. `validateBackboneTokenAnchor` is deliberately closed
 * — its ANCHOR_KEYS is exactly book/chapter/verse_start/verse_end/exact — so
 * that render or presentation evidence can never quietly become part of durable
 * identity (INV-5, INV-17). Widening that validator would also let the field
 * back into newly authored records. So instead the field is stripped by name,
 * on the read path only, immediately before the strict validator runs. The
 * validator's strictness is unchanged.
 *
 * THE LOG IS NEVER REWRITTEN. This normalizes the parsed value in memory only.
 * `annotations/connections.jsonl` keeps its original bytes, so the
 * content/function-word refinement stays on disk and remains recoverable if a
 * future feature wants to reintroduce it under a supported field.
 *
 * FIDELITY — measured, not assumed. Across the 64 anchors carrying the field in
 * the reference library, comparing `exact.occurrences` against
 * `selection_shape.content_occurrences`: 50 agree exactly, 14 disagree, and 0
 * lacked an `exact`. In every disagreement `exact` carries MORE tokens, e.g.
 *
 *     exact.occurrences   = [{verse:3, position:3}, {verse:3, position:5}]
 *     content_occurrences = [{verse:3, position:3}]
 *
 * So dropping the field is lossless for ANCHOR IDENTITY — `exact` is passed
 * through untouched — but it is NOT purely redundant. For those 14 the
 * content-versus-function-word split exists only in the retired field, and
 * after this migration only on disk. Do not describe this drop as "lossless"
 * without that qualification.
 */
export const RETIRED_CONNECTION_ANCHOR_FIELDS = ["selection_shape"] as const;

export type RetiredConnectionAnchorField = typeof RETIRED_CONNECTION_ANCHOR_FIELDS[number];

/**
 * Strip the enumerated retired fields from one format_version 2 anchor so it
 * can reach the closed canonical validator.
 *
 * Contract:
 * - Only the names in {@link RETIRED_CONNECTION_ANCHOR_FIELDS} are removed. Any
 *   other unknown key survives and is refused downstream.
 * - The input is never mutated; a copy is returned only when something was
 *   actually removed, so the common clean-anchor case allocates nothing.
 * - Nothing is added. In particular a missing `exact` is never invented, and no
 *   part of `selection_shape` is promoted into `exact`; an anchor without a
 *   canonical selector stays invalid.
 */
export function migrateRetiredV2AnchorFields(anchor: unknown): unknown {
  if (typeof anchor !== "object" || anchor === null || Array.isArray(anchor)) {
    return anchor;
  }
  const source = anchor as Record<string, unknown>;
  let migrated: Record<string, unknown> | undefined;
  for (const field of RETIRED_CONNECTION_ANCHOR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    if (!migrated) migrated = { ...source };
    delete migrated[field];
  }
  return migrated ?? anchor;
}
