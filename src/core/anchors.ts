/**
 * Where in an episode a passage is discussed.
 *
 * Pure, and shaped to fit `PodcastChapter` — start, bref, title — because an
 * anchor IS a chapter marker, arrived at from the other direction. The dock has
 * carried that contract since it was written with nothing to fill it.
 *
 * These are derived from machine transcripts by semantic similarity, and the
 * tier records how much that claim rests on:
 *
 *   A  the publisher named this passage, and a window scores well for it.
 *      Similarity is being used only for WHERE, which is what it does well.
 *   B  nobody named it, but the score is high AND the talk there names the
 *      book. Two independent signals, which is what an unprompted claim costs.
 *
 * Tier C exists in the built artifact and is never loaded: score alone was
 * measured at roughly half the reliability of a tagged moment, and the gap does
 * not close as the score rises. Those are candidates for a future signal, not
 * things to show a reader.
 */

export interface Anchor {
  /** Seconds from the start of the episode. */
  start: number;
  /** Canonical bref, so a press can reach the reading canvas. */
  bref: string;
  /** Human label — "Matthew 5", or "Deuteronomy 28-30" for a merged span. */
  title: string;
  tier: "A" | "B";
  score: number;
}

export interface AnchorSet {
  schema: "anchors/v1";
  generated: true;
  method: string;
  id: string;
  anchors: Anchor[];
}

export type AnchorResult =
  | { ok: true; anchors: AnchorSet }
  | { ok: false; reason: "absent" | "unreadable" | "refused" | "ungranted" };

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return typeof a["start"] === "number" && Number.isFinite(a["start"])
    && typeof a["bref"] === "string" && a["bref"].startsWith("bref:v1/")
    && typeof a["title"] === "string" && a["title"].length > 0
    && (a["tier"] === "A" || a["tier"] === "B")
    && typeof a["score"] === "number" && Number.isFinite(a["score"]);
}

/**
 * Fails closed, and drops any tier it does not recognise rather than trusting
 * the file — a tier C anchor reaching a reader would be exactly the confident
 * unfounded claim the tiers exist to prevent.
 */
export function readAnchors(parsed: unknown, fallbackId: string): AnchorResult {
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "refused" };
  const candidate = parsed as Record<string, unknown>;
  if (candidate["schema"] !== "anchors/v1") return { ok: false, reason: "refused" };
  if (candidate["generated"] !== true) return { ok: false, reason: "refused" };

  const raw = Array.isArray(candidate["anchors"]) ? candidate["anchors"] : [];
  const anchors = raw.filter(isAnchor);
  if (anchors.length === 0) return { ok: false, reason: "refused" };

  /* Sorted here rather than trusted. The dock finds the active span by scanning
     for the last start at or before the playhead and does not sort first, so
     an unordered list selects the wrong one silently. */
  return {
    ok: true,
    anchors: {
      schema: "anchors/v1",
      generated: true,
      method: typeof candidate["method"] === "string" ? candidate["method"] : "unknown",
      id: typeof candidate["id"] === "string" ? candidate["id"] : fallbackId,
      anchors: [...anchors].sort((a, b) => a.start - b.start),
    },
  };
}
