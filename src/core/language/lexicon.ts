/**
 * Lexicon lookup helpers (pure). Gloss maps are injected by the host.
 */

export type StrongGlossEntry = {
  lemma?: string;
  xlit?: string;
  /** Full English definition (detail pane). */
  gloss: string;
  /** Optional precomputed short label for interlinear strip. */
  short?: string;
};

const WEAK_TAIL = new Set([
  "in", "of", "at", "to", "or", "a", "an", "the", "and", "as", "by", "for",
  "from", "with", "on", "i.e", "ie", "i.e.",
]);

/** Normalize G2673 / H1254 / 1254 → digits only. */
export function normalizeStrongNumber(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^[GgHh]?0*(\d+)$/);
  return m?.[1] ?? null;
}

export function lookupStrongGloss(
  map: ReadonlyMap<string, StrongGlossEntry> | Record<string, StrongGlossEntry>,
  strong: string | undefined | null,
): StrongGlossEntry | null {
  const num = normalizeStrongNumber(strong);
  if (!num) return null;
  const alt = num.replace(/^0+/, "") || num;
  if (map instanceof Map) return map.get(num) ?? map.get(alt) ?? null;
  const rec = map as Record<string, StrongGlossEntry>;
  return rec[num] ?? rec[alt] ?? null;
}

/**
 * Short label for strip chips: 1–3 words, no mid-phrase ellipsis junk.
 * Prefer entry.short when present.
 */
export function shortGlossLabel(
  gloss: string | undefined | null,
  maxWords = 3,
  precomputedShort?: string | null,
): string | null {
  if (precomputedShort?.trim()) {
    return trimToWords(precomputedShort.trim(), maxWords);
  }
  if (!gloss) return null;
  let s = gloss.trim();
  if (!s) return null;

  // Prefer "specifically, X"
  const spec = s.match(/specifically,?\s+(?:an?\s+)?([^).;]+)/i);
  if (spec?.[1]) {
    const t = trimToWords(stripNoise(spec[1]), maxWords);
    if (t) return t;
  }

  // Drop parentheticals, then first clause
  s = stripNoise(s);
  const first = s.split(/[;.]/)[0]?.trim() ?? s;
  const toVerb = first.match(/\bto\s+[a-z][a-z-]*/i);
  if (toVerb) return trimToWords(toVerb[0], maxWords);

  return trimToWords(first, maxWords);
}

function stripNoise(s: string): string {
  let out = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  out = out.replace(
    /^(?:properly,?\s*|a primitive root[;:]?\s*|from the same as[^;]*;?\s*|from\s+H?\d+[^;]*;?\s*|the same as[^;]*;?\s*|of uncertain derivation[;.]?\s*|a primitive word[;.]?\s*)+/i,
    "",
  );
  return out.replace(/\s+/g, " ").trim().replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "");
}

function trimToWords(s: string, maxWords: number): string | null {
  let words = s
    .split(/\s+/)
    .map((w) => w.replace(/^[,;:]+|[,;:]+$/g, ""))
    .filter(Boolean);
  while (words.length && WEAK_TAIL.has(words[words.length - 1]!.toLowerCase().replace(/\.$/, ""))) {
    words = words.slice(0, -1);
  }
  if (words.length > maxWords) words = words.slice(0, maxWords);
  while (words.length && WEAK_TAIL.has(words[words.length - 1]!.toLowerCase().replace(/\.$/, ""))) {
    words = words.slice(0, -1);
  }
  const out = words.join(" ").trim();
  return out.length > 0 ? out : null;
}

/** Parse compact JSON { "1254": { gloss, short?, lemma?, xlit? } }. */
export function parseStrongGlossJson(jsonText: string): Map<string, StrongGlossEntry> {
  const raw = JSON.parse(jsonText) as Record<string, unknown>;
  const map = new Map<string, StrongGlossEntry>();
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const gloss = typeof o.gloss === "string" ? o.gloss.trim() : "";
    if (!gloss) continue;
    const num = normalizeStrongNumber(k) ?? k.replace(/\D/g, "");
    if (!num) continue;
    map.set(num, {
      gloss,
      short: typeof o.short === "string" ? o.short.trim() : undefined,
      lemma: typeof o.lemma === "string" ? o.lemma : undefined,
      xlit: typeof o.xlit === "string" ? o.xlit : undefined,
    });
  }
  return map;
}
