/**
 * B3 Gate 3 preview smoke — live DeepSeek claim extraction over the seeded
 * test corpus, writing validated claims into the library's Derived view so
 * they appear in the app's Living Margin (Claims section) for ACT 19.
 *
 * Requires: seed-test-notes.ts run first, DEEPSEEK_API_KEY in .env.
 * Idempotent: prior claims from this extractor are replaced wholesale.
 *
 * Run: npm run smoke:extract
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ulid } from "ulid";
import { loadEnvFile } from "../src/host/env.js";
import { createDeepSeekProvider } from "../src/host/ai-provider.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { claimSourceHash } from "../src/host/claims-sync.js";
import {
  CLAIMS_PROMPT_VERSION,
  buildClaimExtractionRequest,
  parseClaimExtraction,
} from "../src/core/ai/claim-extraction.js";
import type { BackboneData } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = process.env["LIBRARY_PATH"] ?? resolve(__dirname, "../Library-demo");
const DATA_DIR = resolve(__dirname, "../data/scripture");

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFile(resolve(__dirname, "../.env"));
  const provider = createDeepSeekProvider(process.env);
  if (!provider) fail("no DEEPSEEK_API_KEY configured");

  const backbone = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8")) as BackboneData;
  const db = new SQLiteMaterializer(join(LIBRARY_PATH, ".system/library.sqlite"));
  // B-1: claims persist in the AI-derived store, not the materialized view.
  const store = new EmbeddingsStore(join(LIBRARY_PATH, ".system/embeddings.sqlite"));

  // Gather notes anchored to ACT 19:1-7 (same path the Living Margin uses)
  const anchors = db.queryAnchorsForRange("ACT", 19, 1, 19, 7);
  const noteIds = [...new Set(anchors.filter((a) => a.src_kind === "note").map((a) => a.src_id))];
  if (noteIds.length === 0) fail("no notes anchored to ACT 19:1-7 — run seed-test-notes.ts first");
  const notes = noteIds
    .map((id) => db.queryNoteById(id))
    .filter((n): n is NonNullable<typeof n> => n !== undefined)
    .map((n) => ({ id: n.id, title: n.title, body: n.body_text }));
  console.log(`notes anchored to ACT 19:1-7: ${notes.length}`);
  for (const n of notes) console.log(`  - ${n.title}`);

  const act19 = JSON.parse(readFileSync(join(DATA_DIR, "text/web/ACT/19.json"), "utf-8")) as {
    verses: { verse: number; text: string }[];
  };
  const passageText = act19.verses
    .slice(0, 7)
    .map((v) => `[${v.verse}] ${v.text}`)
    .join(" ");

  const { context, prompt } = buildClaimExtractionRequest("Acts 19:1-7 (WEB)", passageText, notes);

  const started = Date.now();
  const resp = await provider.invoke({
    context,
    prompt,
    responseFormat: "json",
    latency: "background", // extraction quality > latency: thinking enabled
    // Thinking mode consumes completion tokens for reasoning BEFORE emitting
    // JSON (verified: 2000 was fully eaten by reasoning → empty content).
    // Background jobs must budget generously.
    maxTokens: 8000,
  });
  console.log(`\nextraction call: ${Date.now() - started}ms, ${resp.tokensUsed} tokens`);

  const { claims, rejected } = parseClaimExtraction(resp.text, backbone, notes);
  for (const r of rejected) console.log(`  rejected: ${r}`);
  console.log(`valid claims: ${claims.length} (rejected: ${rejected.length})`);
  if (claims.length < 2) fail("expected at least 2 valid claims");
  if (!claims.some((c) => c.evidence.some((e) => e.kind === "note"))) {
    fail("no claim cites note evidence — grounding failed");
  }

  // Replace this extractor's prior output (idempotent re-runs), then insert.
  const extractor = `${provider.model}@${CLAIMS_PROMPT_VERSION}`;
  const removed = store.deleteClaimsByExtractor(extractor);
  if (removed > 0) console.log(`replaced ${removed} prior claims from ${extractor}`);

  const created = new Date().toISOString();
  const notesById = new Map(notes.map((n) => [n.id, n]));
  for (const claim of claims) {
    const id = ulid();
    store.insertClaim({
      id,
      assertion: claim.assertion,
      claim_type: claim.claimType,
      confidence: claim.confidence,
      extractor,
      created,
      status: "active",
    });
    for (const a of claim.anchors) {
      store.insertClaimAnchor({ claim_id: id, book: a.book, chapter: a.chapter, verse: a.verse });
    }
    for (const e of claim.evidence) {
      const src = e.kind === "note" ? notesById.get(e.ref) : undefined;
      store.insertClaimSource({
        claim_id: id,
        kind: e.kind,
        ref: e.ref,
        quote: e.kind === "note" ? e.quote : undefined,
        // B-1: staleness hash — the sweep deletes this claim if the note changes.
        source_hash: src ? claimSourceHash(src.title, src.body) : undefined,
      });
    }
  }

  // Verify through the same query the Living Margin uses.
  const surfaced = store.queryClaimsForRange("ACT", 19, 1, 19, 7);
  const ours = surfaced.filter((c) => c.extractor === extractor);
  console.log(`\nclaims now surfaced for ACT 19:1-7 (extractor ${extractor}):`);
  for (const c of ours) {
    console.log(`  - [${c.claim_type}, ${(c.confidence * 100).toFixed(0)}%] ${c.assertion}`);
  }
  if (ours.length !== claims.length) {
    fail(`inserted ${claims.length} claims but margin query surfaced ${ours.length}`);
  }

  db.close();
  store.close();
  console.log("\nSMOKE PASS");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
