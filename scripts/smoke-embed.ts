/**
 * B3 Gate 2 smoke test — real local embeddings over the seeded test corpus.
 * Requires: `node --import tsx scripts/seed-test-notes.ts` run first.
 * Downloads EmbeddingGemma-300m (q8, ~300MB) on first run.
 *
 * Verifies:
 *  1. incremental sync (second pass skips everything)
 *  2. passage-shaped query surfaces the Spirit/baptism cluster
 *  3. paraphrase query with low keyword overlap surfaces the regeneration
 *     cluster (the case bag-of-words embeddings cannot pass)
 *  4. admin/distractor notes never surface for theological queries
 *
 * Run: npm run smoke:embed
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";
import { embedAllNotes } from "../src/host/embeddings-sync.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { findRelatedNotes } from "../src/core/ai/similarity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = process.env["LIBRARY_PATH"] ?? resolve(__dirname, "../Library-demo");

const DISTRACTOR_IDS = new Set(["01SEEDNOTE0000000000000013", "01SEEDNOTE0000000000000014"]);

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const db = new SQLiteMaterializer(join(LIBRARY_PATH, ".system/library.sqlite"));
  const store = new EmbeddingsStore(join(LIBRARY_PATH, ".system/embeddings.sqlite"));
  const provider = new LocalEmbeddingProvider({
    cacheDir: resolve(__dirname, "../.model-cache"),
  });

  console.log(`model: ${provider.modelId} (dim ${provider.dim})`);

  // --- 1. Incremental sync ---
  let t = Date.now();
  const first = await embedAllNotes(db, store, provider);
  console.log(
    `first sync: ${first.embedded} embedded, ${first.skipped} skipped, ${first.pruned} pruned (${Date.now() - t}ms incl. model load)`,
  );
  if (first.count === 0) fail("no notes found — run scripts/seed-test-notes.ts first");

  t = Date.now();
  const second = await embedAllNotes(db, store, provider);
  console.log(`second sync: ${second.embedded} embedded, ${second.skipped} skipped (${Date.now() - t}ms)`);
  if (second.embedded !== 0 || second.skipped !== second.count) {
    fail(`incremental sync broken: expected all ${second.count} skipped, got ${second.skipped}`);
  }

  const embeddings = store.getAllEmbeddings(provider.modelId);

  const search = async (query: string, label: string) => {
    const started = Date.now();
    const [qvec] = await provider.embed([query], "query");
    const results = findRelatedNotes(qvec!, embeddings, new Set(), 0.3, 5);
    console.log(`\nquery [${label}] (${Date.now() - started}ms): "${query.slice(0, 80)}..."`);
    for (const r of results) {
      const note = db.queryNoteById(r.noteId);
      console.log(`  ${(r.similarity * 100).toFixed(1)}%  ${note?.title ?? r.noteId}`);
    }
    return results;
  };

  // --- 2. Passage-shaped query: ACT 19:1-7 text ---
  const act19 = JSON.parse(
    readFileSync(resolve(__dirname, "../data/scripture/text/web/ACT/19.json"), "utf-8"),
  ) as { verses: { verse: number; text: string }[] };
  const passageText = act19.verses.slice(0, 7).map((v) => v.text).join(" ");

  const passageResults = await search(passageText, "ACT 19:1-7 passage");
  if (passageResults.length === 0) fail("passage query returned nothing");
  const topIds = passageResults.slice(0, 3).map((r) => r.noteId);
  const spiritCluster = new Set([
    "01SEEDNOTE0000000000000001",
    "01SEEDNOTE0000000000000002",
    "01SEEDNOTE0000000000000003",
    "01SEEDNOTE0000000000000004",
    "01SEEDNOTE0000000000000012",
  ]);
  if (!topIds.some((id) => spiritCluster.has(id))) {
    fail("Spirit/baptism cluster missing from passage query top-3");
  }

  // --- 3. Paraphrase query (near-zero keyword overlap with targets) ---
  const paraphraseResults = await search(
    "becoming a completely new person on the inside, a fresh start given by God",
    "paraphrase / regeneration",
  );
  const regenCluster = new Set(["01SEEDNOTE0000000000000005", "01SEEDNOTE0000000000000006"]);
  if (!paraphraseResults.slice(0, 3).some((r) => regenCluster.has(r.noteId))) {
    fail("regeneration cluster missing from paraphrase query top-3 — semantic retrieval not working");
  }

  // --- 4. Distractors must not surface ---
  for (const r of [...passageResults, ...paraphraseResults]) {
    if (DISTRACTOR_IDS.has(r.noteId)) {
      const note = db.queryNoteById(r.noteId);
      fail(`distractor note surfaced for a theological query: ${note?.title}`);
    }
  }

  db.close();
  store.close();
  console.log("\nSMOKE PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
