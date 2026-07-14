/**
 * B3.6 Gate E2 smoke — live enrichment quality over the persona corpus,
 * FAST tier (DeepSeek flash) vs DEEP tier (Codex subscription / GPT-5.5),
 * printed side by side for the human precision hand-check that sets tier
 * defaults. Also verifies A-7: admin notes must come back no_scripture_intent.
 *
 * Run: npm run smoke:enrich
 *   SMOKE_ENRICH_DEEP_LIMIT=n   cap DEEP-tier calls (default 5; each ~15s)
 *   CODEX_DISABLE=1             skip the Codex tier
 */

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/host/env.js";
import { createDeepSeekProvider } from "../src/host/ai-provider.js";
import { createCodexProvider } from "../src/host/codex-provider.js";
import {
  ENRICHMENT_JSON_SCHEMA,
  buildEnrichmentRequest,
  parseEnrichment,
  type ThemeEntry,
} from "../src/core/ai/note-enrichment.js";
import type { AIProvider } from "../src/core/interfaces.js";
import type { BackboneData } from "../src/core/reference/types.js";
import { PERSONA_NOTES } from "./persona-corpus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ADMIN_NOTES = [
  { id: "admin-1", persona: "admin", title: "Small group logistics",
    body: "Rotate hosting: our place first and third weeks. Sarah brings coffee, Mike has the projector. Childcare fund needs $40 more this month.",
    expect: { label: "MUST be no_scripture_intent" } },
  { id: "admin-2", persona: "admin", title: "Website migration checklist",
    body: "Move the sermon archive to the new host before the DNS cutover. Rotate the admin passwords. Test the giving page on mobile.",
    expect: { label: "MUST be no_scripture_intent" } },
];

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function runTier(
  label: string,
  provider: AIProvider,
  notes: { id: string; title: string; body: string; persona: string }[],
  backbone: BackboneData,
  themes: ThemeEntry[],
): Promise<{ valid: number; rejected: number; adminCorrect: number; adminTotal: number }> {
  const themeIds = new Set(themes.map((t) => t.id));
  let valid = 0;
  let rejected = 0;
  let adminCorrect = 0;
  let adminTotal = 0;
  console.log(`\n===== ${label} =====`);
  for (const note of notes) {
    const { context, prompt } = buildEnrichmentRequest({ title: note.title, body: note.body }, themes);
    const started = Date.now();
    try {
      const resp = await provider.invoke({
        context,
        prompt,
        responseFormat: "json",
        jsonSchema: ENRICHMENT_JSON_SCHEMA,
        latency: "background",
        maxTokens: 4000,
      });
      const parsed = parseEnrichment(resp.text, backbone, themeIds);
      console.log(`\n  [${note.persona}] "${note.body.slice(0, 60)}" (${Date.now() - started}ms)`);
      if (!parsed.ok) {
        rejected++;
        console.log(`    REJECTED: ${parsed.reason}`);
        continue;
      }
      valid++;
      const e = parsed.enrichment;
      if (note.persona === "admin") {
        adminTotal++;
        if (e.noScriptureIntent) adminCorrect++;
        console.log(`    no_scripture_intent: ${e.noScriptureIntent} ${e.noScriptureIntent ? "✓" : "✗ A-7 VIOLATION"}`);
        continue;
      }
      console.log(
        `    refs:   ${e.inferredRefs.map((r) => `${r.book} ${r.chapter}${r.verseStart !== undefined ? `:${r.verseStart}-${r.verseEnd}` : ""}`).join(", ") || "(none)"}`,
      );
      console.log(`    themes: ${e.themes.join(", ")}`);
      console.log(`    expand: ${e.expansion}`);
    } catch (err) {
      rejected++;
      console.log(`    ERROR: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  return { valid, rejected, adminCorrect, adminTotal };
}

async function main(): Promise<void> {
  loadEnvFile(resolve(__dirname, "../.env"));
  const backbone = JSON.parse(
    readFileSync(join(resolve(__dirname, "../data/scripture"), "backbone.json"), "utf-8"),
  ) as BackboneData;
  const themes = (
    JSON.parse(readFileSync(join(resolve(__dirname, "../data/themes"), "themes-seed-en.json"), "utf-8")) as {
      themes: ThemeEntry[];
    }
  ).themes;

  const personaNotes = PERSONA_NOTES.map((n) => ({ id: n.id, title: n.title, body: n.body, persona: n.persona }));
  const fastNotes = [...personaNotes, ...ADMIN_NOTES.map((n) => ({ id: n.id, title: n.title, body: n.body, persona: n.persona }))];

  const fast = createDeepSeekProvider(process.env);
  if (!fast) fail("no DEEPSEEK_API_KEY configured");
  const fastStats = await runTier(`FAST: ${fast.model}`, fast, fastNotes, backbone, themes);

  const deepLimit = parseInt(process.env["SMOKE_ENRICH_DEEP_LIMIT"] ?? "5", 10);
  const deep = createCodexProvider(process.env);
  let deepStats: Awaited<ReturnType<typeof runTier>> | null = null;
  if (deep) {
    // Representative subset: hardest quick notes + one admin (A-7).
    const subset = [...personaNotes.slice(0, Math.max(1, deepLimit - 1)), fastNotes[fastNotes.length - 1]!];
    deepStats = await runTier(`DEEP: codex subscription (${deep.model})`, deep, subset, backbone, themes);
  } else {
    console.log("\n(DEEP tier skipped: codex unavailable or CODEX_DISABLE=1)");
  }

  console.log("\n===== summary =====");
  console.log(`FAST: ${fastStats.valid} valid, ${fastStats.rejected} rejected, admin A-7: ${fastStats.adminCorrect}/${fastStats.adminTotal}`);
  if (deepStats) {
    console.log(`DEEP: ${deepStats.valid} valid, ${deepStats.rejected} rejected, admin A-7: ${deepStats.adminCorrect}/${deepStats.adminTotal}`);
  }
  if (fastStats.valid === 0) fail("FAST tier produced zero valid enrichments");
  console.log("\nSMOKE PASS (precision hand-check above sets tier defaults)");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
