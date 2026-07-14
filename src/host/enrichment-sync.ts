/**
 * Incremental note-enrichment sync — Node host layer (B3.6 Gate E2).
 * Runs the enrich-v1 contract over notes whose content hash changed, with
 * FAST→DEEP escalation: the budget model tries first; validator rejection
 * escalates to the strong tier (plausible-but-wrong output only surfaces as
 * user distrust, so quality wins where errors are invisible).
 *
 * Enrichments are Derived (INV-2): regenerable, precisely invalidated by
 * (content_hash, extractor), swept when notes are deleted.
 */

import { createHash } from "node:crypto";
import type { AIProvider } from "../core/interfaces.js";
import type { BackboneData } from "../core/reference/types.js";
import {
  ENRICH_PROMPT_VERSION,
  ENRICHMENT_JSON_SCHEMA,
  buildEnrichmentRequest,
  parseEnrichment,
  type ThemeEntry,
} from "../core/ai/note-enrichment.js";
import type { EmbeddingsStore } from "./embeddings-store.js";

export type EnrichTier = {
  provider: AIProvider;
  /** Stable id for the extractor field, e.g. "deepseek-v4-flash". */
  modelId: string;
};

export type EnrichSyncResult = {
  count: number;
  enriched: number;
  skipped: number;
  rejected: number;
  escalated: number;
  swept: number;
  tokensUsed: number;
};

export function enrichmentContentHash(title: string, bodyText: string): string {
  return createHash("sha256").update(`${title}\n${bodyText}`).digest("hex");
}

export async function enrichAllNotes(deps: {
  notes: { id: string; title: string; body_text: string }[];
  store: EmbeddingsStore;
  backbone: BackboneData;
  themes: ThemeEntry[];
  /**
   * Tiers in priority order — tried until one validates. Per the model
   * routing decision, enrichment leads with the STRONG tier when available
   * (plausible-but-wrong refs pass validation; quality is only visible to
   * users), with cheaper tiers as fallback.
   */
  tiers: EnrichTier[];
  log?: (line: string) => void;
}): Promise<EnrichSyncResult> {
  const { notes, store, backbone, themes, tiers } = deps;
  if (tiers.length === 0) throw new Error("enrichAllNotes: at least one tier required");
  const log = deps.log ?? (() => undefined);
  const themeIds = new Set(themes.map((t) => t.id));
  const result: EnrichSyncResult = {
    count: notes.length,
    enriched: 0,
    skipped: 0,
    rejected: 0,
    escalated: 0,
    swept: 0,
    tokensUsed: 0,
  };

  const tryTier = async (
    tier: EnrichTier,
    note: { id: string; title: string; body_text: string },
  ): Promise<{ ok: boolean; reason?: string; enrichment?: ReturnType<typeof parseEnrichment> }> => {
    const { context, prompt } = buildEnrichmentRequest({ title: note.title, body: note.body_text }, themes);
    try {
      const resp = await tier.provider.invoke({
        context,
        prompt,
        responseFormat: "json",
        jsonSchema: ENRICHMENT_JSON_SCHEMA,
        latency: "background",
        maxTokens: 4000,
        temperature: 0, // reproducible inferred refs — gate stability matters
      });
      result.tokensUsed += resp.tokensUsed;
      const parsed = parseEnrichment(resp.text, backbone, themeIds);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      return { ok: true, enrichment: parsed };
    } catch (err) {
      // Transport failures (timeout, network, provider down) are tier
      // failures, not job failures — the next tier gets its shot.
      return { ok: false, reason: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
  };

  const extractorOf = (tier: EnrichTier): string => `${tier.modelId}@${ENRICH_PROMPT_VERSION}`;

  for (const note of notes) {
    const hash = enrichmentContentHash(note.title, note.body_text);
    // Current under ANY configured tier's extractor counts as current.
    if (tiers.some((t) => store.isEnrichmentCurrent(note.id, hash, extractorOf(t)))) {
      result.skipped++;
      continue;
    }

    let attempt: Awaited<ReturnType<typeof tryTier>> = { ok: false, reason: "no tiers tried" };
    let extractor = extractorOf(tiers[0]!);
    for (const [i, tier] of tiers.entries()) {
      if (i > 0) {
        log(`  fall back [${note.title}]: ${tiers[i - 1]!.modelId} rejected (${attempt.reason})`);
        result.escalated++;
      }
      attempt = await tryTier(tier, note);
      extractor = extractorOf(tier);
      if (attempt.ok) break;
    }
    if (!attempt.ok || !attempt.enrichment?.ok) {
      log(`  reject [${note.title}]: ${attempt.reason ?? "unknown"}`);
      result.rejected++;
      continue;
    }

    const e = attempt.enrichment.enrichment;
    store.upsertEnrichment({
      noteId: note.id,
      contentHash: hash,
      extractor,
      noScriptureIntent: e.noScriptureIntent,
      inferredRefs: e.inferredRefs,
      themes: e.themes,
      expansion: e.expansion,
      created: new Date().toISOString(),
    });
    result.enriched++;
  }

  // Sweep enrichments for deleted notes.
  const liveIds = new Set(notes.map((n) => n.id));
  for (const enr of store.getAllEnrichments()) {
    if (!liveIds.has(enr.noteId)) {
      store.deleteEnrichment(enr.noteId);
      result.swept++;
    }
  }

  return result;
}
