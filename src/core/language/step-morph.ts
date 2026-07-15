/**
 * STEPBible TEGMC / TEHMC full-morphology overlay (Approach A).
 *
 * Lookup by exact morphCode → phrase + functional explanation + example.
 * Does NOT replace our chip labels / morphExplain — open-notes enrichment only.
 *
 * Source: https://github.com/STEPBible/STEPBible-Data (CC BY 4.0)
 */

export type StepMorphOverlay = {
  code: string;
  /** Short English phrase, e.g. "Verb Future Passive Indicative 3rd Plural" */
  phrase: string;
  /** Functional sentence for non-specialists */
  explanation: string;
  /** Generic template example (not verse-specific) */
  example: string;
  /** Attribution for UI */
  source: "STEPBible TEGMC" | "STEPBible TEHMC";
};

type StepEntry = StepMorphOverlay;

/**
 * In-memory index of STEP full morphology codes.
 * Load once from TEGMC + TEHMC text files.
 */
export class StepMorphIndex {
  private byCode = new Map<string, StepEntry>();
  private loaded = false;

  get isLoaded(): boolean {
    return this.loaded;
  }

  get size(): number {
    return new Set([...this.byCode.values()].map((e) => e.code)).size;
  }

  /**
   * Parse and merge one STEP table file.
   * @param text raw file contents
   * @param source which table (for attribution)
   */
  loadTable(text: string, source: StepMorphOverlay["source"]): number {
    const entries = parseStepFullTable(text, source);
    let n = 0;
    for (const e of entries) {
      this.byCode.set(e.code, e);
      this.byCode.set(e.code.toUpperCase(), e);
      n++;
    }
    this.loaded = this.byCode.size > 0;
    return n;
  }

  /**
   * Lookup morphCode with light normalization (Approach A enrichment).
   * Never invents morphology — only tries codes that exist in STEP tables.
   *
   * Greek: strip trailing extras (-S, -C, -ATT, -LG…) then retry.
   * Hebrew: composites `HC/Ncmpc` → try `HNcmpc` (re-prefix last segment);
   *         strip pronominal suffixes Sp3ms etc. then retry.
   * Proper names HNp/ANp: no STEP row — return a tiny deterministic stub.
   */
  lookup(code: string | undefined | null): StepMorphOverlay | null {
    if (!code || !this.loaded) return null;
    const c = code.trim();
    if (!c) return null;

    for (const candidate of stepLookupCandidates(c)) {
      const hit = this.byCode.get(candidate) ?? this.byCode.get(candidate.toUpperCase());
      if (hit) {
        // Prefer returning the STEP row; if we matched via normalize, keep STEP's
        // own code field but that's fine for display.
        return hit;
      }
    }

    // Proper-name codes are extremely common in OSHB and absent from TEHMC full table.
    if (c === "HNp" || c === "ANp") {
      return properNameStub(c);
    }
    // Composite ending in /Np (e.g. HC/Np)
    if (/\/Np$/i.test(c) || /\/Np\//i.test(c)) {
      return properNameStub(c.startsWith("A") ? "ANp" : "HNp");
    }

    return null;
  }

  /** Exact key only — used by audit scripts. */
  lookupExact(code: string | undefined | null): StepMorphOverlay | null {
    if (!code || !this.loaded) return null;
    const c = code.trim();
    return this.byCode.get(c) ?? this.byCode.get(c.toUpperCase()) ?? null;
  }
}

/**
 * Ordered candidates for STEP lookup (first hit wins).
 * Exported for unit tests / coverage scripts.
 */
export function stepLookupCandidates(code: string): string[] {
  const c = code.trim();
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };

  add(c);
  add(c.toUpperCase());

  // Greek: strip trailing extras repeatedly (superlative -S, comparative -C, ATTIC, gentilic…)
  let g = c;
  for (let i = 0; i < 4; i++) {
    const next = g.replace(/-(?:ATT|ABB|LG|PG|C|S|N|K|L|T|P|I|M|F)$/i, "");
    if (next === g) break;
    add(next);
    g = next;
  }
  // Drop final -SEGMENT if still multi-part (rare)
  const parts = c.split("-");
  if (parts.length >= 3) {
    add(parts.slice(0, -1).join("-"));
  }
  // Second aorist marker V-2AAI → V-AAI already usually exact; keep for safety
  if (/^V-2/i.test(c)) add(c.replace(/^V-2/i, "V-"));

  // Hebrew / Aramaic composites and suffixes
  const langPrefix = c.startsWith("A") || c.startsWith("a") ? "A" : "H";
  const rePrefix = (seg: string): string[] => {
    const variants = [seg];
    if (!/^[HAhA]/.test(seg)) {
      variants.push(langPrefix + seg, "H" + seg, "A" + seg);
    }
    return variants;
  };
  const stripSuffix = (seg: string): string =>
    seg.replace(/S[pfd][123][a-z]{1,2}$/i, "");

  if (c.includes("/")) {
    const segs = c.split("/").filter(Boolean);
    // Prefer last segment (lexical word): HC/Ncmpc → HNcmpc
    const last = segs[segs.length - 1]!;
    for (const v of rePrefix(last)) add(v);
    for (const v of rePrefix(stripSuffix(last))) add(v);
    // Other segments (less ideal prose, but better than nothing)
    for (const s of segs.slice(0, -1).reverse()) {
      for (const v of rePrefix(s)) add(v);
      for (const v of rePrefix(stripSuffix(s))) add(v);
    }
  } else {
    // Atomic + pronominal suffix glued
    const stripped = stripSuffix(c);
    if (stripped !== c) {
      add(stripped);
      for (const v of rePrefix(stripped)) add(v);
    }
  }

  return out;
}

function properNameStub(code: "HNp" | "ANp" | string): StepMorphOverlay {
  const aramaic = code.startsWith("A");
  return {
    code,
    phrase: aramaic ? "Aramaic proper name" : "Hebrew proper name",
    explanation: "A name — a person, place, or title.",
    example: "",
    source: "STEPBible TEHMC",
  };
}

/** Shared process-wide index (host loads files once). */
let shared: StepMorphIndex | null = null;

export function getSharedStepMorphIndex(): StepMorphIndex {
  if (!shared) shared = new StepMorphIndex();
  return shared;
}

/** Test helper — replace shared index. */
export function setSharedStepMorphIndex(index: StepMorphIndex | null): void {
  shared = index;
}

/**
 * Parse FULL MORPHOLOGY CODES section of TEGMC/TEHMC.
 * Blocks are separated by lines that are only `$`.
 */
export function parseStepFullTable(
  text: string,
  source: StepMorphOverlay["source"],
): StepEntry[] {
  const start = text.search(/^FULL MORPHOLOGY CODES:/m);
  if (start < 0) return [];
  const body = text.slice(start);
  const blocks = body.split(/\n\$\s*\n/);
  const out: StepEntry[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, "").trimEnd())
      .filter((l) => l.trim().length > 0);

    let codeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (/^[A-Za-z0-9][A-Za-z0-9\-_/]*Function=/.test(l)) {
        codeLineIdx = i;
        break;
      }
      if (/^[A-Za-z0-9][A-Za-z0-9\-_/]*\s+Function=/.test(l)) {
        codeLineIdx = i;
        break;
      }
      if (
        /^[A-Za-z0-9][A-Za-z0-9\-_/]{1,24}$/.test(l.trim()) &&
        lines[i + 1]?.includes("Function=")
      ) {
        codeLineIdx = i;
        break;
      }
    }
    if (codeLineIdx < 0) continue;

    let code: string;
    let fields: string;
    const raw0 = lines[codeLineIdx]!;
    const glued = raw0.match(/^([A-Za-z0-9][A-Za-z0-9\-_/]*)(Function=.*)$/);
    if (glued) {
      code = glued[1]!;
      fields = glued[2]!;
    } else {
      const spaced = raw0.match(/^([A-Za-z0-9][A-Za-z0-9\-_/]*)\s+(Function=.*)$/);
      if (spaced) {
        code = spaced[1]!;
        fields = spaced[2]!;
      } else if (/^[A-Za-z0-9][A-Za-z0-9\-_/]+$/.test(raw0.trim())) {
        code = raw0.trim();
        fields = lines[codeLineIdx + 1] ?? "";
        codeLineIdx += 1;
      } else {
        continue;
      }
    }

    if (code.includes("CODE") || code.length < 2) continue;

    const rest = lines.slice(codeLineIdx + 1);
    const phrase = stripQuotes(rest[0] ?? "");
    const explanation = stripQuotes(rest[1] ?? "");
    const example = stripQuotes(rest[2] ?? "")
      .replace(/^Example:\s*/i, "")
      .trim();

    if (!fields.includes("Function=") && !phrase) continue;

    out.push({
      code,
      phrase,
      explanation,
      example,
      source,
    });
  }
  return out;
}

function stripQuotes(s: string): string {
  // TEHMC/TEGMC often wrap lines in quotes; some lines leave a leading " after
  // partial parse — strip all edge quotes/spaces repeatedly.
  let t = s.trim();
  while (t.length && (t.startsWith('"') || t.startsWith("'"))) t = t.slice(1).trim();
  while (t.length && (t.endsWith('"') || t.endsWith("'"))) t = t.slice(0, -1).trim();
  return t;
}
