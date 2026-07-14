/**
 * Margin retrieval calibration — B3.5 Gate R2.
 * Measures the chunk-level cosine distribution of the current corpus against
 * contrasting passages so the decision-layer floors (DEFAULT_RETRIEVAL_OPTIONS
 * in src/core/ai/retrieval.ts) can be verified against reality whenever the
 * corpus or the embedding model changes.
 *
 * Successor of the 2026-07-02 audit script (audit-similarity.ts) that
 * measured EmbeddingGemma's unrelated-cosine floor at ~0.5 and exposed the
 * broken 0.3 threshold.
 *
 * Run: npm run calibrate:margin  (requires seeded + embedded Library-demo)
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { cosineSimilarity } from "../src/core/ai/similarity.js";
import { parseChunkSrcId, DEFAULT_RETRIEVAL_OPTIONS } from "../src/core/ai/retrieval.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = process.env["LIBRARY_PATH"] ?? resolve(__dirname, "../Library-demo");
const DATA_DIR = resolve(__dirname, "../data/scripture");

function passage(book: string, chapter: number, from: number, to: number): string {
  const data = JSON.parse(
    readFileSync(join(DATA_DIR, `text/web/${book}/${chapter}.json`), "utf-8"),
  ) as { verses: { verse: number; text: string }[] };
  return data.verses
    .filter((v) => v.verse >= from && v.verse <= to)
    .map((v) => v.text)
    .join(" ");
}

async function main(): Promise<void> {
  const db = new SQLiteMaterializer(join(LIBRARY_PATH, ".system/library.sqlite"));
  const store = new EmbeddingsStore(join(LIBRARY_PATH, ".system/embeddings.sqlite"));
  const provider = new LocalEmbeddingProvider({ cacheDir: resolve(__dirname, "../.model-cache") });
  const embeddings = store.getAllEmbeddings(provider.modelId);
  const chunkRows = embeddings.filter((e) => e.srcKind === "note_chunk");
  console.log(`chunk embeddings: ${chunkRows.length} (model ${provider.modelId})`);
  console.log(
    `floors: dense=${DEFAULT_RETRIEVAL_OPTIONS.denseFloor} soft=${DEFAULT_RETRIEVAL_OPTIONS.softFloor} gap=${DEFAULT_RETRIEVAL_OPTIONS.scoreGap}`,
  );

  const queries: [string, string][] = [
    ["ACT 19:1-7 (Spirit/baptism — related notes exist)", passage("ACT", 19, 1, 7)],
    ["GEN 1:1-10 (creation — John-prologue echo expected)", passage("GEN", 1, 1, 10)],
    ["PSA 23:1-6 (shepherd — shepherd-note echo possible)", passage("PSA", 23, 1, 6)],
    ["MRK 16:1-8 (empty tomb — resurrection chunk echo)", passage("MRK", 16, 1, 8)],
    ["LEV 13:1-8 (skin-disease law — MUST be silent)", passage("LEV", 13, 1, 8)],
    ["EST 3:1-9 (court intrigue — MUST be silent)", passage("EST", 3, 1, 9)],
  ];

  const floor = DEFAULT_RETRIEVAL_OPTIONS.denseFloor;
  for (const [label, text] of queries) {
    const [qvec] = await provider.embed([text.slice(0, 1500)], "query");
    const best = new Map<string, { sim: number; index: number }>();
    for (const row of chunkRows) {
      const parsed = parseChunkSrcId(row.srcId);
      if (!parsed) continue;
      const sim = cosineSimilarity(qvec!, row.vector);
      const prev = best.get(parsed.noteId);
      if (!prev || sim > prev.sim) best.set(parsed.noteId, { sim, index: parsed.index });
    }
    const scored = [...best.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.sim - a.sim);
    console.log(`\n=== ${label} ===`);
    for (const s of scored) {
      const note = db.queryNoteById(s.id);
      const bar = "#".repeat(Math.max(0, Math.round((s.sim - 0.2) * 100)));
      const above = s.sim >= floor ? `>=${floor}` : "      ";
      console.log(
        `  ${s.sim.toFixed(3)} ${above} c${s.index} ${bar.padEnd(30)} ${note?.title ?? s.id}`,
      );
    }
  }

  db.close();
  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
