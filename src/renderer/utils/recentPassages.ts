/**
 * Recent-passage memory for the passage picker.
 * Pure helpers — no React, no IPC — so they stay easy to test and reuse.
 */

export interface RecentPassage {
  /** Canonical book code, e.g. "ACT". */
  book: string;
  chapter: number;
  /** Optional verse when the jump landed on one (xref / jump box). */
  verse?: number;
  /** Last-used translation package for this stop. */
  packageId: string;
  /** Epoch ms — used for ordering. */
  visitedAt: number;
}

export const RECENT_PASSAGES_MAX = 8;

/** Stable identity: same book+chapter collapses, independent of package/verse. */
export function recentKey(r: Pick<RecentPassage, "book" | "chapter">): string {
  return `${r.book}:${r.chapter}`;
}

/**
 * Push a visit to the front. Drops older duplicates of the same book+chapter,
 * keeps at most RECENT_PASSAGES_MAX. Package/verse refresh on re-visit so
 * "open Acts 19 again from KJV" updates the chip metadata without a second row.
 */
export function pushRecent(
  list: RecentPassage[],
  visit: RecentPassage,
): RecentPassage[] {
  const key = recentKey(visit);
  const rest = list.filter((r) => recentKey(r) !== key);
  return [visit, ...rest].slice(0, RECENT_PASSAGES_MAX);
}

/** Remove one entry (e.g. dismiss chip). */
export function removeRecent(
  list: RecentPassage[],
  target: Pick<RecentPassage, "book" | "chapter">,
): RecentPassage[] {
  const key = recentKey(target);
  return list.filter((r) => recentKey(r) !== key);
}

/** Defensive parse of settings JSON / store payload. */
export function normalizeRecents(raw: unknown): RecentPassage[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentPassage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const book = typeof o.book === "string" ? o.book : "";
    const chapter = typeof o.chapter === "number" ? o.chapter : Number(o.chapter);
    if (!book || !Number.isFinite(chapter) || chapter < 1) continue;
    const packageId = typeof o.packageId === "string" ? o.packageId : "web";
    const visitedAt =
      typeof o.visitedAt === "number" && Number.isFinite(o.visitedAt)
        ? o.visitedAt
        : Date.now();
    const verse =
      typeof o.verse === "number" && Number.isFinite(o.verse) && o.verse >= 1
        ? o.verse
        : undefined;
    const key = `${book}:${chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ book, chapter, packageId, visitedAt, verse });
    if (out.length >= RECENT_PASSAGES_MAX) break;
  }
  return out;
}

export function formatRecentLabel(
  r: RecentPassage,
  bookNames: Record<string, string[] | undefined>,
): string {
  const name = bookNames[r.book]?.[0] ?? r.book;
  if (r.verse != null) return `${name} ${r.chapter}:${r.verse}`;
  return `${name} ${r.chapter}`;
}
