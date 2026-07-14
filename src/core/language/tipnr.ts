/**
 * TIPNR people/places index — individualised names (not lemma buckets).
 * Data: STEPBible TIPNR CC BY 4.0 → tipnr-index.json
 */

export type TipnrEntity = {
  id: string;
  kind: "person" | "place" | "other";
  displayName: string;
  brief: string;
  short?: string;
  uStrong: string;
  baseStrong: string;
  firstRef?: string;
  refs: string[];
  refCount: number;
  gender?: string;
};

export type TipnrIndexFile = {
  version: 1;
  source: string;
  license: string;
  generatedAt: string;
  entityCount: number;
  entities: Record<string, TipnrEntity>;
  byRef: Record<string, string[]>;
  byBaseStrong: Record<string, string[]>;
};

export type NameResolveQuery = {
  book: string;
  chapter: number;
  verse: number;
  /** e.g. G2491 or G2491H or 2491 */
  strong?: string | null;
  /** surface or gloss hint, e.g. "John" */
  nameHint?: string | null;
};

export type NameResolveHit = {
  entity: TipnrEntity;
  /** How we matched — for debugging / UI confidence */
  match: "ref+strong" | "ref" | "strong+name" | "strong";
  /** Other candidates at this verse (disambiguation) */
  alternatives: TipnrEntity[];
};

export class TipnrIndex {
  private data: TipnrIndexFile | null = null;

  get loaded(): boolean {
    return this.data != null;
  }

  get entityCount(): number {
    return this.data?.entityCount ?? 0;
  }

  loadJson(jsonText: string): number {
    this.data = JSON.parse(jsonText) as TipnrIndexFile;
    return this.data.entityCount;
  }

  get(id: string): TipnrEntity | null {
    return this.data?.entities[id] ?? null;
  }

  /**
   * Resolve a proper-name token in a verse to TIPNR individual(s).
   * Prefer ref ∩ strong so "John" at Mat.3.1 → Baptist, not the Apostle.
   */
  resolve(q: NameResolveQuery): NameResolveHit | null {
    if (!this.data) return null;
    const refKey = `${q.book.toUpperCase()}.${q.chapter}.${q.verse}`;
    const atRef = (this.data.byRef[refKey] ?? [])
      .map((id) => this.data!.entities[id])
      .filter(Boolean) as TipnrEntity[];

    const base = normalizeStrongKey(q.strong ?? "");
    const byStrong = base
      ? ((this.data.byBaseStrong[base] ?? [])
          .map((id) => this.data!.entities[id])
          .filter(Boolean) as TipnrEntity[])
      : [];

    if (atRef.length === 0 && byStrong.length === 0) return null;

    // Best: same verse + matching Strong
    if (base && atRef.length) {
      const both = atRef.filter(
        (e) => normalizeStrongKey(e.baseStrong) === base || normalizeStrongKey(e.uStrong) === base
          || e.uStrong.toUpperCase().startsWith(base),
      );
      if (both.length === 1) {
        return {
          entity: both[0]!,
          match: "ref+strong",
          alternatives: atRef.filter((e) => e.id !== both[0]!.id),
        };
      }
      if (both.length > 1) {
        const picked = pickByNameHint(both, q.nameHint) ?? both[0]!;
        return {
          entity: picked,
          match: "ref+strong",
          alternatives: both.filter((e) => e.id !== picked.id),
        };
      }
    }

    // Verse-only (rare name at this location)
    if (atRef.length === 1) {
      return { entity: atRef[0]!, match: "ref", alternatives: [] };
    }
    if (atRef.length > 1) {
      const picked = pickByNameHint(atRef, q.nameHint) ?? atRef[0]!;
      return {
        entity: picked,
        match: "ref",
        alternatives: atRef.filter((e) => e.id !== picked.id),
      };
    }

    // Strong only — may be multiple Johns; prefer name hint
    if (byStrong.length === 1) {
      return { entity: byStrong[0]!, match: "strong", alternatives: [] };
    }
    if (byStrong.length > 1) {
      const picked = pickByNameHint(byStrong, q.nameHint) ?? byStrong[0]!;
      return {
        entity: picked,
        match: "strong+name",
        alternatives: byStrong.filter((e) => e.id !== picked.id).slice(0, 5),
      };
    }

    return null;
  }
}

function normalizeStrongKey(s: string): string {
  const m = s.trim().match(/^([GH])0*(\d+)/i);
  if (!m) return s.trim().toUpperCase();
  return `${m[1]!.toUpperCase()}${m[2]}`;
}

function pickByNameHint(list: TipnrEntity[], hint?: string | null): TipnrEntity | null {
  if (!hint?.trim()) return null;
  const h = hint.trim().toLowerCase();
  const exact = list.find((e) => e.displayName.toLowerCase() === h);
  if (exact) return exact;
  const starts = list.find((e) => e.displayName.toLowerCase().startsWith(h));
  if (starts) return starts;
  const inBrief = list.find(
    (e) => e.brief.toLowerCase().includes(h) || (e.short ?? "").toLowerCase().includes(h),
  );
  return inBrief ?? null;
}

/** Detect whether a language token looks like a proper name worth resolving. */
export function tokenLooksLikeProperName(token: {
  wordType?: string;
  morphCode?: string;
  morph?: { pos?: string };
  strongPrefixed?: string;
  strong?: string;
  gloss?: string | null;
}): boolean {
  const wt = (token.wordType ?? "").toLowerCase();
  if (wt === "proper" || wt === "name") return true;
  const code = token.morphCode ?? "";
  if (code === "HNp" || code === "ANp" || /\/Np$/i.test(code)) return true;
  // Greek name morph extras: N-NSM-P, N-PRI, N-*-L location
  if (/^N-.*-(P|T|L|LG|PG)$/i.test(code) || code === "N-PRI") return true;
  if ((token.morph?.pos ?? "").toLowerCase() === "noun" && wt.includes("proper")) return true;
  return false;
}

let shared: TipnrIndex | null = null;

export function getSharedTipnrIndex(): TipnrIndex {
  if (!shared) shared = new TipnrIndex();
  return shared;
}

export function setSharedTipnrIndex(idx: TipnrIndex | null): void {
  shared = idx;
}
