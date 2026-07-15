/**
 * MACULA / MARBLE semantic-sense helpers.
 *
 * The source SDBG export assigns one or more Louw-Nida sense ids to each
 * Greek token.  These are occurrence-level annotations, unlike a prose
 * lexicon outline inferred from Thayer typography.
 */

import type { TokenRecord } from "./types.js";

export type GreekSemanticSenseTag = {
  /** Louw-Nida sense id, e.g. 12.18. */
  id: string;
  /** Source gloss from the MARBLE SDBG export. */
  label: string;
  /** Source semantic-domain label when present. */
  domain?: string;
};

export type GreekSemanticSenseParseResult = {
  byKey: Map<string, GreekSemanticSenseTag>;
  /** Diagnostic only; UI lookup deliberately requires the exact lemma+id key. */
  byId: Map<string, GreekSemanticSenseTag>;
  conflicts: Array<{ key: string; labels: string[] }>;
  ambiguousIds: Array<{ id: string; labels: string[] }>;
};

export type GreekSemanticSenseItem = {
  /** Stable frequency rank within the lemma. */
  rank: number;
  /** Source ids collapsed when their visible gloss is identical. */
  ids: string[];
  label: string;
  domain?: string;
  count: number;
  current: boolean;
  examples: string[];
};

export type GreekSemanticSenseOutline = {
  source: "MACULA / MARBLE";
  total: number;
  hiddenCount: number;
  taggedOccurrences: number;
  totalOccurrences: number;
  senses: GreekSemanticSenseItem[];
};

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Parse Clear Bible's `sdbg-domains-glosses.xml` into compact lemma+id lookups.
 * Some ids carry different wording under different lemmas, so the UI never
 * falls back to an id-only match.
 */
export function parseMaculaSdbgSenseGlosses(xml: string): GreekSemanticSenseParseResult {
  const candidates = new Map<string, Map<string, { count: number; domain?: string }>>();
  const morphRe = /<morph\b([^>]*?)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = morphRe.exec(xml))) {
    const attrs = match[1] ?? "";
    const sdbgRaw = attrs.match(/\bSDBG="([^"]*)"/)?.[1];
    if (!sdbgRaw) continue;
    const domainRaw = attrs.match(/\bDomain="([^"]*)"/)?.[1] ?? "";
    const domainParts = decodeXmlAttribute(domainRaw).split("|");
    const senseParts = decodeXmlAttribute(sdbgRaw).split("|");

    for (let i = 0; i < senseParts.length; i++) {
      const fields = senseParts[i]!.split(";");
      const lemma = fields[0]?.trim() ?? "";
      const id = fields[1]?.trim() ?? "";
      const label = fields.slice(2).join(";").replace(/\s+/g, " ").trim();
      if (!lemma || !/^\d+\.\d+[a-z]?$/.test(id) || !label) continue;
      const key = semanticSenseLookupKey(lemma, id);

      const domainFields = (domainParts[i] ?? domainParts[0] ?? "").split(";");
      const domain = domainFields.slice(1).join(";").replace(/\s+/g, " ").trim() || undefined;
      const labels = candidates.get(key) ?? new Map<string, { count: number; domain?: string }>();
      const current = labels.get(label);
      labels.set(label, {
        count: (current?.count ?? 0) + 1,
        ...(current?.domain || domain ? { domain: current?.domain ?? domain } : {}),
      });
      candidates.set(key, labels);
    }
  }

  const byKey = new Map<string, GreekSemanticSenseTag>();
  const conflicts: GreekSemanticSenseParseResult["conflicts"] = [];
  for (const [key, labels] of candidates) {
    const ranked = [...labels.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
    );
    const winner = ranked[0];
    if (!winner) continue;
    const id = key.slice(key.lastIndexOf("|") + 1);
    byKey.set(key, {
      id,
      label: winner[0],
      ...(winner[1].domain ? { domain: winner[1].domain } : {}),
    });
    if (ranked.length > 1) conflicts.push({ key, labels: ranked.map(([label]) => label) });
  }

  const labelsById = new Map<string, Map<string, GreekSemanticSenseTag>>();
  for (const tag of byKey.values()) {
    const labels = labelsById.get(tag.id) ?? new Map<string, GreekSemanticSenseTag>();
    labels.set(tag.label, tag);
    labelsById.set(tag.id, labels);
  }
  const byId = new Map<string, GreekSemanticSenseTag>();
  const ambiguousIds: GreekSemanticSenseParseResult["ambiguousIds"] = [];
  for (const [id, labels] of labelsById) {
    if (labels.size === 1) {
      const tag = labels.values().next().value as GreekSemanticSenseTag | undefined;
      if (tag) byId.set(id, tag);
    } else {
      ambiguousIds.push({ id, labels: [...labels.keys()].sort() });
    }
  }

  return { byKey, byId, conflicts, ambiguousIds };
}

/** Accent-insensitive lookup; source and TSV sometimes encode oxia/tonos differently. */
export function semanticSenseLookupKey(lemma: string | undefined, id: string): string {
  const normalizedLemma = (lemma ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .trim();
  return `${normalizedLemma}|${id.trim()}`;
}

/** Attach source glosses to one token's one-or-more Louw-Nida ids. */
export function semanticSenseTagsForToken(
  token: Pick<TokenRecord, "lemma" | "louwNida">,
  index: Pick<GreekSemanticSenseParseResult, "byKey">,
): GreekSemanticSenseTag[] {
  const ids = token.louwNida?.trim().split(/\s+/).filter(Boolean) ?? [];
  const tags: GreekSemanticSenseTag[] = [];
  for (const id of ids) {
    const hit = index.byKey.get(semanticSenseLookupKey(token.lemma, id));
    if (hit && !tags.some((tag) => tag.id === hit.id)) tags.push(hit);
  }
  return tags;
}

function senseGroupKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\p{L}]+/gu, " ")
    .trim();
}

function refForToken(token: TokenRecord): string {
  return `${token.book}.${token.chapter}.${token.verse}`;
}

/**
 * Build a compact, frequency-ranked semantic outline for one lemma.
 *
 * - identical source glosses collapse even when MARBLE assigns two ids;
 * - a one-sense lemma gets no separate widget;
 * - the visible outline is capped, but every selected occurrence sense stays
 *   visible even when it is outside the lemma's most frequent senses.
 */
export function buildGreekSemanticSenseOutline(opts: {
  tokens: readonly TokenRecord[];
  focus: TokenRecord;
  maxVisible?: number;
}): GreekSemanticSenseOutline | null {
  const maxVisible = Math.max(2, opts.maxVisible ?? 6);
  const currentIds = new Set((opts.focus.semanticSenses ?? []).map((sense) => sense.id));
  const groups = new Map<
    string,
    {
      ids: Set<string>;
      label: string;
      domains: Map<string, number>;
      count: number;
      current: boolean;
      examples: string[];
    }
  >();
  let taggedOccurrences = 0;

  for (const token of opts.tokens) {
    const tags = token.semanticSenses ?? [];
    if (tags.length === 0) continue;
    taggedOccurrences++;
    const seenGroups = new Set<string>();
    for (const tag of tags) {
      const key = senseGroupKey(tag.label);
      if (!key || seenGroups.has(key)) continue;
      seenGroups.add(key);
      const group = groups.get(key) ?? {
        ids: new Set<string>(),
        label: tag.label.trim(),
        domains: new Map<string, number>(),
        count: 0,
        current: false,
        examples: [],
      };
      group.ids.add(tag.id);
      group.count++;
      group.current ||= currentIds.has(tag.id);
      if (tag.domain) group.domains.set(tag.domain, (group.domains.get(tag.domain) ?? 0) + 1);
      const ref = refForToken(token);
      if (!group.examples.includes(ref) && group.examples.length < 3) group.examples.push(ref);
      groups.set(key, group);
    }
  }

  if (groups.size < 2) return null;

  const ranked: GreekSemanticSenseItem[] = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((group, index) => {
      const domain = [...group.domains.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0];
      return {
        rank: index + 1,
        ids: [...group.ids].sort(),
        label: group.label,
        ...(domain ? { domain } : {}),
        count: group.count,
        current: group.current,
        examples: group.examples,
      };
    });

  const visible = ranked.slice(0, maxVisible);
  for (const current of ranked.filter((sense) => sense.current && !visible.includes(sense))) {
    const replaceAt = [...visible]
      .map((sense, index) => ({ sense, index }))
      .reverse()
      .find(({ sense }) => !sense.current)?.index;
    if (replaceAt === undefined) break;
    visible[replaceAt] = current;
  }
  visible.sort((a, b) => a.rank - b.rank);

  return {
    source: "MACULA / MARBLE",
    total: ranked.length,
    hiddenCount: ranked.length - visible.length,
    taggedOccurrences,
    totalOccurrences: opts.tokens.length,
    senses: visible,
  };
}
