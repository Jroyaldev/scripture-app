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
  /** All Strong keys for this individual (Hebrew + Greek forms). */
  strongs?: string[];
  firstRef?: string;
  refs: string[];
  refCount: number;
  gender?: string;
};

export type TipnrIndexFile = {
  version: 1 | 2;
  source: string;
  license: string;
  generatedAt: string;
  entityCount: number;
  personCount?: number;
  placeCount?: number;
  otherCount?: number;
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

export type TipnrSearchHit = {
  entity: TipnrEntity;
  match: "name" | "description";
  score: number;
};

export class TipnrIndex {
  private data: TipnrIndexFile | null = null;

  get loaded(): boolean {
    return this.data != null;
  }

  get entityCount(): number {
    return this.data?.entityCount ?? 0;
  }

  get source(): string {
    return this.data?.source ?? "STEPBible TIPNR";
  }

  get license(): string {
    return this.data?.license ?? "CC BY 4.0";
  }

  loadJson(jsonText: string): number {
    this.data = JSON.parse(jsonText) as TipnrIndexFile;
    return this.data.entityCount;
  }

  get(id: string): TipnrEntity | null {
    return this.data?.entities[id] ?? null;
  }

  /**
   * Search individual people and places. Name closeness always outranks a
   * description-only match; this keeps “Paul” precise while still allowing a
   * generic role such as “apostle” to surface several useful people.
   */
  search(query: string, limit = 20): TipnrSearchHit[] {
    if (!this.data) return [];
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];
    const terms = normalizedQuery.split(" ").filter((term) => term.length > 1);
    if (terms.length === 0) return [];
    const hits: TipnrSearchHit[] = [];

    for (const entity of Object.values(this.data.entities)) {
      if (entity.kind !== "person" && entity.kind !== "place") continue;
      const name = normalizeSearchText(formatTipnrDisplayName(entity.displayName));
      const nameTokens = name.split(" ");
      const description = normalizeSearchText(`${entity.brief} ${entity.short ?? ""}`);
      let nameScore = 0;

      if (name === normalizedQuery) nameScore = 1000;
      else if (name.startsWith(normalizedQuery)) nameScore = 920;
      else if (nameTokens.some((token) => token === normalizedQuery)) nameScore = 880;
      else if (terms.some((term) => nameTokens.some((token) => token === term))) nameScore = 840;
      else if (name.includes(normalizedQuery)) nameScore = 800;
      else if (terms.every((term) => nameTokens.some((token) => token.startsWith(term)))) nameScore = 760;
      else if (normalizedQuery.length >= 4 && editDistance(name, normalizedQuery) <= 2) nameScore = 720;

      if (nameScore > 0) {
        hits.push({
          entity,
          match: "name",
          score: nameScore + Math.min(30, Math.log2(entity.refCount + 1)),
        });
        continue;
      }

      const descriptionMatches = terms.filter((term) => description.includes(term)).length;
      if (descriptionMatches === 0) continue;
      const complete = descriptionMatches === terms.length;
      hits.push({
        entity,
        match: "description",
        score: 300 + descriptionMatches * 28 + (complete ? 35 : 0)
          + Math.min(30, Math.log2(entity.refCount + 1)),
      });
    }

    return hits
      .sort((left, right) => right.score - left.score
        || right.entity.refCount - left.entity.refCount
        || formatTipnrDisplayName(left.entity.displayName).localeCompare(formatTipnrDisplayName(right.entity.displayName)))
      .slice(0, Math.max(1, limit));
  }

  /**
   * Return the unique people and places explicitly indexed in a canonical
   * verse range. Ordering follows first appearance, never global popularity.
   */
  entitiesForRange(
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number,
  ): TipnrEntity[] {
    if (!this.data) return [];
    const start = Math.max(1, Math.min(startVerse, endVerse));
    const end = Math.max(start, Math.max(startVerse, endVerse));
    const seen = new Set<string>();
    const entities: TipnrEntity[] = [];
    for (let verse = start; verse <= end; verse += 1) {
      const refKey = `${book.toUpperCase()}.${chapter}.${verse}`;
      for (const id of this.data.byRef[refKey] ?? []) {
        if (seen.has(id)) continue;
        const entity = this.data.entities[id];
        if (!entity || (entity.kind !== "person" && entity.kind !== "place")) continue;
        seen.add(id);
        entities.push(entity);
      }
    }
    return entities;
  }

  /**
   * Resolve a proper-name token in a verse to TIPNR individual(s).
   * Prefer ref ∩ strong so "John" at Mat.3.1 → Baptist, not the Apostle.
   * When verse has unrelated names but Strong is known, prefer Strong
   * (high-frequency names may still miss a ref in the index).
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
      const both = atRef.filter((e) => entityHasStrong(e, base));
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
      // Verse has entities but none share this Strong → fall through to Strong
      // (do not pick an unrelated name at the same verse).
    }

    // Strong (+ optional name) when no verse∩strong hit
    if (byStrong.length === 1) {
      return {
        entity: byStrong[0]!,
        match: "strong",
        alternatives: atRef.filter((e) => e.id !== byStrong[0]!.id),
      };
    }
    if (byStrong.length > 1) {
      const picked = pickByNameHint(byStrong, q.nameHint) ?? pickPrimaryIndividual(byStrong) ?? byStrong[0]!;
      return {
        entity: picked,
        match: "strong+name",
        alternatives: byStrong.filter((e) => e.id !== picked.id).slice(0, 5),
      };
    }

    // Verse-only — only when we have no Strong (or Strong empty in index)
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

    return null;
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 3;
}

function normalizeStrongKey(s: string): string {
  const m = s.trim().match(/^([GH])0*(\d+)/i);
  if (!m) return s.trim().toUpperCase();
  return `${m[1]!.toUpperCase()}${m[2]}`;
}

function entityHasStrong(e: TipnrEntity, base: string): boolean {
  if (!base) return false;
  if (normalizeStrongKey(e.baseStrong) === base) return true;
  if (normalizeStrongKey(e.uStrong) === base) return true;
  if (e.uStrong.toUpperCase().startsWith(base)) return true;
  for (const s of e.strongs ?? []) {
    if (normalizeStrongKey(s) === base) return true;
  }
  return false;
}

function pickByNameHint(list: TipnrEntity[], hint?: string | null): TipnrEntity | null {
  if (!hint?.trim()) return null;
  const h = hint.trim().toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, "");
  if (!h) return null;
  const label = (e: TipnrEntity) => formatTipnrDisplayName(e.displayName).toLowerCase();
  const exact = list.find((e) => e.displayName.toLowerCase() === h || label(e) === h);
  if (exact) return exact;
  // "Bethany" should beat "Beth-barah" when both share a Strong
  const starts = list.find(
    (e) => e.displayName.toLowerCase().startsWith(h) || label(e).startsWith(h),
  );
  if (starts) return starts;
  const contains = list.find(
    (e) => e.displayName.toLowerCase().includes(h) || label(e).includes(h),
  );
  if (contains) return contains;
  const inBrief = list.find(
    (e) => e.brief.toLowerCase().includes(h) || (e.short ?? "").toLowerCase().includes(h),
  );
  return inBrief ?? null;
}

/** Prefer the individual with the most passage hits (Jesus over Barabbas for G2424). */
function pickPrimaryIndividual(list: TipnrEntity[]): TipnrEntity | null {
  if (!list.length) return null;
  return [...list].sort((a, b) => (b.refCount ?? 0) - (a.refCount ?? 0))[0] ?? null;
}

/**
 * TIPNR machine IDs use underscores (Olives_Mount, Mary_Magdalene).
 * Prefer a readable label for UI chips and titles.
 */
export function formatTipnrDisplayName(raw: string): string {
  if (!raw?.trim()) return raw ?? "";
  let s = raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d+)(?=\s|$)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  // Olives Mount → Mount of Olives; Halak Mount → Mount Halak
  const mount = s.match(/^(.+?)\s+Mount$/i);
  if (mount && !/^Mount\b/i.test(s)) {
    const base = mount[1]!.trim();
    s = /^Olives$/i.test(base) ? "Mount of Olives" : `Mount ${base}`;
  }
  const plains = s.match(/^(.+?)\s+Plains$/i);
  if (plains && !/^Plains\b/i.test(s)) {
    s = `Plains of ${plains[1]!.trim()}`;
  }
  return s;
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
  if (wt === "proper" || wt === "name" || wt.includes("proper")) return true;
  const code = token.morphCode ?? "";
  if (code === "HNp" || code === "ANp" || /\/Np\b/i.test(code) || /\/Np$/i.test(code)) return true;
  // Greek: indeclinable proper (N-PRI), person/place/title morph extras
  if (code === "N-PRI" || /^N-.*-(P|T|L|LG|PG)$/i.test(code)) return true;
  // Hebrew proper often only wordType; also noun + capitalized English gloss
  if ((token.morph?.pos ?? "").toLowerCase() === "noun" && wt === "proper") return true;
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
