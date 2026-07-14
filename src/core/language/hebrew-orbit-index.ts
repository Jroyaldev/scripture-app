/**
 * Hebrew Rendering Orbit adapter — Strong’s → English gloss spectrum
 * from MACULA Hebrew leaves (not OSHB, which lacks glosses).
 */

import type { OrbitSegment, RenderingOrbit } from "./rendering-orbit.js";

export type HebrewOrbitFile = {
  version: 1;
  source: string;
  license: string;
  generatedAt: string;
  strongCount: number;
  orbits: Record<
    string,
    {
      total: number;
      segments: { label: string; count: number; share: number }[];
    }
  >;
};

export class HebrewOrbitIndex {
  private data: HebrewOrbitFile | null = null;

  get loaded(): boolean {
    return this.data != null;
  }

  loadJson(jsonText: string): number {
    this.data = JSON.parse(jsonText) as HebrewOrbitFile;
    return this.data.strongCount;
  }

  /**
   * Look up multi-band orbit for a Hebrew Strong number.
   * Returns null if missing / not loaded.
   */
  resolve(opts: {
    strong?: string | null;
    strongPrefixed?: string | null;
    lemma?: string | null;
    surface?: string | null;
    currentGloss?: string | null;
  }): RenderingOrbit | null {
    if (!this.data) return null;
    const raw = opts.strong ?? opts.strongPrefixed ?? "";
    const key = raw.replace(/^[Hh]/, "").replace(/^0+/, "") || raw;
    if (!key) return null;
    const hit = this.data.orbits[key];
    if (!hit || hit.total === 0) return null;

    const current = (opts.currentGloss ?? "").toLowerCase().trim();
    const segments: OrbitSegment[] = hit.segments.map((s) => ({
      label: s.label,
      count: s.count,
      share: s.share,
      isCurrent:
        current.length > 0 &&
        (s.label.toLowerCase() === current ||
          current.includes(s.label.toLowerCase()) ||
          s.label.toLowerCase().includes(current.slice(0, 12))),
    }));
    if (!segments.some((s) => s.isCurrent) && segments[0]) {
      // mark top band lightly if current matches via stem already in label
      const top = segments[0];
      if (current && top.label.toLowerCase().startsWith(current.slice(0, 4))) {
        top.isCurrent = true;
      }
    }

    return {
      lemma: opts.lemma || opts.surface || `H${key}`,
      strongPrefixed: opts.strongPrefixed ?? `H${key}`,
      total: hit.total,
      lemmaCount: hit.total,
      segments,
      source: "package-gloss",
      kind: "content",
    };
  }
}

let shared: HebrewOrbitIndex | null = null;

export function getSharedHebrewOrbitIndex(): HebrewOrbitIndex {
  if (!shared) shared = new HebrewOrbitIndex();
  return shared;
}

export function setSharedHebrewOrbitIndex(idx: HebrewOrbitIndex | null): void {
  shared = idx;
}
