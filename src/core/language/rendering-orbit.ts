/**
 * Rendering Orbit — corpus map of how a lemma is glossed in the package.
 *
 * Not a Logos “translation ring” clone: open-data gloss histogram (MACULA
 * Berean glosses, etc.) as a compact circular spectrum. Segment size = share
 * of occurrences. Pure / regenerable from TokenRecord indexes.
 */

export type OrbitSegment = {
  /** Normalized English rendering label. */
  label: string;
  count: number;
  /** 0–1 share of total counted occurrences. */
  share: number;
  /** True when this segment matches the selected token’s gloss. */
  isCurrent?: boolean;
};

export type RenderingOrbit = {
  lemma: string;
  strongPrefixed?: string;
  /** Total occurrences used for the histogram (glossed only). */
  total: number;
  /** Corpus lemma frequency (may exceed total if some rows lack gloss). */
  lemmaCount: number;
  segments: OrbitSegment[];
  /** Data provenance for UI attribution. */
  source: "package-gloss" | "strongs-only";
};

const MAX_SEGMENTS = 8;

/** Normalize gloss text for bucketing (strip brackets, collapse spaces). */
export function normalizeOrbitGloss(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let s = raw
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Drop leading of/the/a for grouping without erasing content words
  s = s.replace(/^(of|the|a|an|to|and)\s+/i, "").trim();
  if (!s || s.length > 48) {
    if (s.length > 48) s = s.slice(0, 45).trim() + "…";
  }
  return s || null;
}

/** Display form of a normalized orbit label (title-ish, short). */
export function formatOrbitLabel(normalized: string): string {
  if (!normalized) return normalized;
  return normalized
    .split(" ")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Build an orbit from lemma → gloss counts.
 * `glossForId` returns the raw gloss for each token id in the lemma list.
 */
export function buildRenderingOrbit(opts: {
  lemma: string;
  strongPrefixed?: string | null;
  lemmaCount: number;
  tokenIds: readonly string[];
  glossForId: (id: string) => string | null | undefined;
  currentGloss?: string | null;
}): RenderingOrbit | null {
  const { lemma, tokenIds } = opts;
  if (!lemma || tokenIds.length === 0) return null;

  const counts = new Map<string, number>();
  let total = 0;
  for (const id of tokenIds) {
    const g = normalizeOrbitGloss(opts.glossForId(id));
    if (!g) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
    total += 1;
  }

  // Strong's-only fallback: single segment from current gloss if corpus empty
  if (total === 0) {
    const one = normalizeOrbitGloss(opts.currentGloss);
    if (!one) return null;
    return {
      lemma,
      strongPrefixed: opts.strongPrefixed ?? undefined,
      total: 1,
      lemmaCount: opts.lemmaCount || 1,
      segments: [{ label: formatOrbitLabel(one), count: 1, share: 1, isCurrent: true }],
      source: "strongs-only",
    };
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, MAX_SEGMENTS);
  const used = top.reduce((s, [, c]) => s + c, 0);
  const rest = total - used;
  const currentNorm = normalizeOrbitGloss(opts.currentGloss);

  const segments: OrbitSegment[] = top.map(([label, count]) => ({
    label: formatOrbitLabel(label),
    count,
    share: count / total,
    isCurrent: currentNorm === label,
  }));

  if (rest > 0) {
    segments.push({
      label: `Other (${sorted.length - top.length})`,
      count: rest,
      share: rest / total,
      isCurrent: false,
    });
  }

  // If current gloss was collapsed into "Other", mark nearest match
  if (currentNorm && !segments.some((s) => s.isCurrent)) {
    const hit = segments.find((s) => s.label.toLowerCase().includes(currentNorm.slice(0, 12)));
    if (hit) hit.isCurrent = true;
  }

  return {
    lemma,
    strongPrefixed: opts.strongPrefixed ?? undefined,
    total,
    lemmaCount: opts.lemmaCount || total,
    segments,
    source: "package-gloss",
  };
}

/** SVG path for a donut segment from angle a0→a1 (radians, 0 = top). */
export function donutSegmentPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + rOuter * Math.sin(a0);
  const y0 = cy - rOuter * Math.cos(a0);
  const x1 = cx + rOuter * Math.sin(a1);
  const y1 = cy - rOuter * Math.cos(a1);
  const x2 = cx + rInner * Math.sin(a1);
  const y2 = cy - rInner * Math.cos(a1);
  const x3 = cx + rInner * Math.sin(a0);
  const y3 = cy - rInner * Math.cos(a0);
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** Distinct soft spectrum — not Logos palette. */
export const ORBIT_PALETTE = [
  "#6B9AC4", // slate blue
  "#C4A35A", // antique gold
  "#7BAE7F", // sage
  "#C47B8A", // dusty rose
  "#8B7EC8", // soft violet
  "#5FA8A0", // teal
  "#C48B5A", // clay
  "#7A8B9A", // blue-gray
  "#9A9A9A", // other
] as const;
