/**
 * Rendering Orbit — corpus map of how a **lemma** is rendered in English.
 *
 * Pastor use (same job as Logos Translation ring on an original-language
 * lemma): “When this Greek/Hebrew dictionary form appears, which English
 * words show up, and how often?” — not helper-word noise, not a mix of
 * unrelated lemmas.
 *
 * Data: package glosses (MACULA Berean-style, etc.), open license.
 * Not a Logos UI clone; idea is a standard word-study visualization.
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
  /**
   * content = full ring (default for nouns/verbs/adjectives).
   * function = suppressed (articles, common particles) — usually not returned.
   */
  kind: "content" | "function";
};

const MAX_SEGMENTS = 8;

/** Closed-class / helper lemmas pastors do not open a ring to study. */
const FUNCTION_POS = new Set([
  "article",
  "conjunction",
  "preposition",
  "particle",
  "pronoun",
  "relative",
  "demonstrative",
  "interrogative",
  "indefinite",
  "adverbial", // only if also short particles — handled carefully
]);

const FUNCTION_WORD_CLASS = new Set([
  "article",
  "conj",
  "conjunction",
  "prep",
  "preposition",
  "particle",
  "pronoun",
  "det",
  "determiner",
]);

/**
 * True for words where a big “translation spectrum” confuses more than helps
 * (articles, καί, ἐν, ὁ…). Content lemmas (noun/verb/adj) stay false.
 */
export function isFunctionWordForOrbit(token: {
  wordClass?: string;
  wordType?: string;
  morph?: { pos?: string };
  morphCode?: string;
  lemma?: string;
  gloss?: string | null;
}): boolean {
  const pos = (token.morph?.pos ?? "").toLowerCase();
  const wc = (token.wordClass ?? "").toLowerCase();
  if (FUNCTION_POS.has(pos) || FUNCTION_WORD_CLASS.has(wc)) return true;
  // Greek morph codes: CONJ, PREP, PRT, T- (article), ADV particles
  const code = (token.morphCode ?? "").toUpperCase();
  if (
    code === "CONJ" ||
    code === "PREP" ||
    code === "PRT" ||
    code === "PART" ||
    code.startsWith("T-") || // article
    code.startsWith("P-") || // pronoun families in Robinson
    /^C-/.test(code)
  ) {
    return true;
  }
  // Hebrew: article, conjunction, preposition prefixes often as separate tokens
  if (/^H(Td|Ti|Tr|Tc|R|C)/i.test(token.morphCode ?? "")) return true;
  // Very short lemmas that are classic particles (Greek)
  const lemma = (token.lemma ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (
    lemma === "και" ||
    lemma === "δε" ||
    lemma === "γαρ" ||
    lemma === "ουν" ||
    lemma === "εν" ||
    lemma === "εις" ||
    lemma === "εκ" ||
    lemma === "προς" ||
    lemma === "ο" ||
    lemma === "η" ||
    lemma === "το" ||
    lemma === "ου" ||
    lemma === "μη" ||
    lemma === "τε" ||
    lemma === "αλλα" ||
    lemma === "ως"
  ) {
    return true;
  }
  return false;
}

const GLOSS_STOP = new Set([
  "of", "the", "a", "an", "to", "and", "in", "on", "at", "by", "for", "with",
  "from", "into", "unto", "as", "o", "oh",
  "be", "is", "are", "was", "were", "been", "being", "am",
  "have", "has", "had", "having", "hav",
  "do", "does", "did", "done", "doing",
  "will", "shall", "may", "might", "can", "could", "would", "should",
  "his", "her", "its", "their", "our", "your", "my", "he", "she", "it", "they", "we", "you", "i",
  "this", "that", "these", "those", "who", "which", "whom",
]);

/**
 * Normalize gloss for bucketing — Logos-style: merge king/kings/king’s,
 * strip interlinear glue (of/the/a/have been…), keep distinct content
 * renderings (word vs account vs saying).
 */
export function normalizeOrbitGloss(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  // Drop empty interlinear placeholders
  if (raw.trim() === "-" || raw.trim() === "—") return null;

  let s = raw
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[“”"'’]/g, "")
    .replace(/[;:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!s) return null;

  // Keep content tokens only (drop auxiliaries / glue — pastor cares about
  // "perfect" not "have been perfected" as a separate band)
  const content = s
    .split(/\s+/)
    .map((w) => stemEnglishToken(w))
    .filter((w) => w.length > 0 && !GLOSS_STOP.has(w));

  if (content.length === 0) {
    // Pure function gloss ("and", "the") — keep stemmed head
    const head = stemEnglishToken(s.split(/\s+/)[0] ?? "");
    return head || null;
  }

  // Prefer single headword when one content token (Logos groups inflections)
  if (content.length === 1) {
    const one = content[0]!;
    return one.length > 40 ? one.slice(0, 37) + "…" : one;
  }

  // Short content phrases: "love feast", "whole offering"
  const joined = content.slice(0, 3).join(" ");
  return joined.length > 48 ? joined.slice(0, 45).trim() + "…" : joined;
}

/**
 * Collapse English inflectional variants the way Logos groups
 * "king, king's, kings" and "perfect, perfected, perfectly".
 */
export function stemEnglishToken(w: string): string {
  let s = w.toLowerCase().replace(/[^a-z-]/g, "");
  if (!s || s.length <= 2) return s;

  // possessives / plurals
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ves") && s.length > 4) s = s.slice(0, -3) + "f";
  else if (s.endsWith("ses") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) s = s.slice(0, -1);

  // adverbs / participles / past
  if (s.endsWith("ingly") && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith("edly") && s.length > 5) s = s.slice(0, -2);
  else if (s.endsWith("ly") && s.length > 4) s = s.slice(0, -2);

  if (s.endsWith("ing") && s.length > 5) {
    const base = s.slice(0, -3);
    s = base.endsWith("tt") || base.endsWith("nn") ? base.slice(0, -1) : base;
  } else if (s.endsWith("ed") && s.length > 4) {
    // complete+d → completed: drop final d only when stem ended in e
    // (…e + d). Otherwise drop -ed (walked → walk).
    if (/[aeiou][^aeiou]ed$/.test(s) && /e[^aeiou]ed$/.test(s)) {
      s = s.slice(0, -1); // completed → complete, loved → love
    } else {
      const base = s.slice(0, -2);
      s = base.endsWith("tt") || base.endsWith("nn") ? base.slice(0, -1) : base;
    }
  }

  // Common irregulars + stem repairs for MACULA glosses
  const irregular: Record<string, string> = {
    was: "be",
    were: "be",
    been: "be",
    is: "be",
    are: "be",
    am: "be",
    children: "child",
    men: "man",
    women: "woman",
    feet: "foot",
    teeth: "tooth",
    geese: "goose",
    belov: "love",
    beloved: "love",
    complet: "complete",
    fulfil: "fulfill",
  };
  return irregular[s] ?? s;
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
 * Returns null for function lemmas (helpers) so the UI stays pastoral.
 */
export function buildRenderingOrbit(opts: {
  lemma: string;
  strongPrefixed?: string | null;
  lemmaCount: number;
  tokenIds: readonly string[];
  glossForId: (id: string) => string | null | undefined;
  currentGloss?: string | null;
  /** When true, skip building a full ring (articles, καί, …). */
  suppressAsFunction?: boolean;
}): RenderingOrbit | null {
  const { lemma, tokenIds } = opts;
  if (!lemma || tokenIds.length === 0) return null;

  if (opts.suppressAsFunction) {
    return null;
  }

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
      kind: "content",
    };
  }

  // Single dominant rendering with no real variation — still show (Logos does),
  // but pastors see “almost always X” clearly.
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

  if (currentNorm && !segments.some((s) => s.isCurrent)) {
    const hit = segments.find(
      (s) =>
        s.label.toLowerCase() === currentNorm ||
        s.label.toLowerCase().includes(currentNorm.slice(0, 10)),
    );
    if (hit) hit.isCurrent = true;
  }

  return {
    lemma,
    strongPrefixed: opts.strongPrefixed ?? undefined,
    total,
    lemmaCount: opts.lemmaCount || total,
    segments,
    source: "package-gloss",
    kind: "content",
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
  "#6B9AC4",
  "#C4A35A",
  "#7BAE7F",
  "#C47B8A",
  "#8B7EC8",
  "#5FA8A0",
  "#C48B5A",
  "#7A8B9A",
  "#9A9A9A",
] as const;
