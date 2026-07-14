/**
 * Persona magic gate — B3.6 (Q1/Q2 executable).
 * Simulates realistic note-taker personas (quick capturers, sermon sketchers,
 * devotional journalers — people who do NOT type scripture refs or theological
 * vocabulary into notes), runs the FULL shipping pipeline (E0 quick-ref
 * anchoring → enrichment → chunk+expansion embedding → hybrid retrieval), and
 * gates:
 *   Q1: ≥9/10 ref-free quick+sermon expectations resurface, each with a reason
 *   Q2: silence holds (LEV 13 / EST 3 stay empty for persona notes)
 *   E0: slang-ref notes are ANCHORED (deterministic citizens)
 * Journal persona is reported but not gated (human decision 2026-07-02).
 *
 * Requires DEEPSEEK_API_KEY (FAST enrichment); escalates to Codex (DEEP) when
 * available. Run: npm run eval:personas
 */

import { rmSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LibraryEngine } from "../src/host/library.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";
import { embedAllNotes } from "../src/host/embeddings-sync.js";
import { enrichAllNotes } from "../src/host/enrichment-sync.js";
import { runSemanticMargin } from "../src/host/semantic-margin-host.js";
import { loadEnvFile } from "../src/host/env.js";
import { createDeepSeekProvider } from "../src/host/ai-provider.js";
import { createCodexProvider } from "../src/host/codex-provider.js";
import { cosineSimilarity } from "../src/core/ai/similarity.js";
import { extractKeywords, parseChunkSrcId, DEFAULT_RETRIEVAL_OPTIONS } from "../src/core/ai/retrieval.js";
import type { ThemeEntry } from "../src/core/ai/note-enrichment.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import type { CrossRefData } from "../src/core/margin/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data/scripture");
const TSK_PATH = resolve(__dirname, "../data/cross-references/tsk.json");
const TMP_LIB = resolve(__dirname, "../tmp-persona-eval");

import { PERSONA_NOTES } from "./persona-corpus.js";

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function passage(book: string, chapter: number, from: number, to: number): string {
  const data = loadJson<{ verses: { verse: number; text: string }[] }>(
    join(DATA_DIR, `text/web/${book}/${chapter}.json`),
  );
  return data.verses
    .filter((v) => v.verse >= from && v.verse <= to)
    .map((v) => v.text)
    .join(" ");
}

async function main(): Promise<void> {
  const backbone = loadJson<BackboneData>(join(DATA_DIR, "backbone.json"));
  const bookNames = loadJson<BookNameMap>(join(DATA_DIR, "book-names-en.json"));
  const crossRefData = existsSync(TSK_PATH) ? loadJson<CrossRefData>(TSK_PATH) : null;

  // Fresh throwaway library each run.
  rmSync(TMP_LIB, { recursive: true, force: true });
  mkdirSync(TMP_LIB, { recursive: true });
  const engine = new LibraryEngine(TMP_LIB, backbone, bookNames);
  engine.initLibrary();
  engine.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));
  for (const n of PERSONA_NOTES) engine.createNote(n.id, n.title, n.body, { type: "study", tags: [n.persona] });
  engine.buildSqlite();

  const db = new SQLiteMaterializer(join(TMP_LIB, ".system/library.sqlite"));
  const embeddingsStore = new EmbeddingsStore(join(TMP_LIB, ".system/embeddings.sqlite"));
  const provider = new LocalEmbeddingProvider({ cacheDir: resolve(__dirname, "../.model-cache") });

  // Enrichment (FAST tier + DEEP escalation) BEFORE embedding, so expansion
  // chunks and inferred refs participate in retrieval — the shipping order.
  loadEnvFile(resolve(__dirname, "../.env"));
  const themes = loadJson<{ themes: ThemeEntry[] }>(
    join(resolve(__dirname, "../data/themes"), "themes-seed-en.json"),
  ).themes;
  const fast = createDeepSeekProvider(process.env);
  const deep = createCodexProvider(process.env);
  if (fast) {
    // Routing decision: enrichment leads with the STRONG tier (Codex
    // subscription) when available; FAST (DeepSeek) is the fallback.
    const tiers = [
      ...(deep ? [{ provider: deep, modelId: `codex-${deep.model}` }] : []),
      { provider: fast, modelId: fast.model },
    ];
    console.log(`enrichment tiers: ${tiers.map((t) => t.modelId).join(" → ")}`);
    const enrichResult = await enrichAllNotes({
      notes: db.getAllNotes(),
      store: embeddingsStore,
      backbone,
      themes,
      tiers,
      log: (line) => console.log(line),
    });
    console.log(
      `enrichment: ${enrichResult.enriched} enriched, ${enrichResult.skipped} skipped, ${enrichResult.rejected} rejected, ${enrichResult.escalated} escalated (${enrichResult.tokensUsed} tokens)`,
    );
  } else {
    console.log("enrichment SKIPPED: no DEEPSEEK_API_KEY — measuring the unenriched pipeline");
  }

  await embedAllNotes(db, embeddingsStore, provider, themes);

  const embeddings = embeddingsStore.getAllEmbeddings(provider.modelId);
  const opts = DEFAULT_RETRIEVAL_OPTIONS;

  console.log(`\npersonas: ${PERSONA_NOTES.length} notes | floors dense=${opts.denseFloor} soft=${opts.softFloor}\n`);
  console.log(
    "persona  surfaced  dense   lex-rank  anchors  expectation",
  );
  console.log("-".repeat(110));

  const byPersona = new Map<string, { hits: number; total: number }>();
  const failures: string[] = [];
  let gatedHits = 0;
  let gatedTotal = 0;
  for (const n of PERSONA_NOTES) {
    const text = passage(n.expect.book, n.expect.chapter, n.expect.from, n.expect.to);
    const result = await runSemanticMargin({
      db, embeddingsStore, provider, crossRefData, bookNames, themes,
      request: {
        book: n.expect.book, startChapter: n.expect.chapter, startVerse: n.expect.from,
        endChapter: n.expect.chapter, endVerse: n.expect.to, passageText: text,
      },
    });
    const surfaced = result.semanticNotes.find((sn) => sn.noteId === n.id);
    // Gate E0: a slang ref makes the note a full citizen of the DETERMINISTIC
    // margin (anchored) — the strongest possible outcome, counted as a hit.
    const anchored = db
      .queryAnchorsForRange(n.expect.book, n.expect.chapter, n.expect.from, n.expect.chapter, n.expect.to)
      .some((a) => a.src_kind === "note" && a.src_id === n.id);

    // Channel diagnostics (why did it hit/miss?)
    const [qvec] = await provider.embed([text.slice(0, 1500)], "query");
    let bestSim = 0;
    for (const row of embeddings) {
      if (row.srcKind !== "note_chunk") continue;
      const parsed = parseChunkSrcId(row.srcId);
      if (parsed?.noteId !== n.id) continue;
      bestSim = Math.max(bestSim, cosineSimilarity(qvec!, row.vector));
    }
    const keywords = extractKeywords(text);
    const lexIds = keywords.length > 0 ? db.searchNotes(keywords.join(" OR "), 20).map((r) => r.id) : [];
    const lexRank = lexIds.indexOf(n.id);
    const anchors = db.queryAnchorsBySrcId(n.id).length;

    const stat = byPersona.get(n.persona) ?? { hits: 0, total: 0 };
    stat.total++;
    const hit = Boolean(surfaced) || anchored;
    if (hit) stat.hits++;
    byPersona.set(n.persona, stat);

    // Gate accounting: ref-free quick+sermon notes are the Q1 population;
    // slang-ref notes must be ANCHORED (E0); journal is reported, not gated.
    const isSlangRef = anchors > 0;
    if (!isSlangRef && (n.persona === "quick" || n.persona === "sermon")) {
      gatedTotal++;
      if (hit) gatedHits++;
      if (surfaced && surfaced.reasons.length === 0) {
        failures.push(`Q1/M4: "${n.title}" surfaced without a reason`);
      }
    }
    if (isSlangRef && !anchored) {
      failures.push(`E0: slang-ref note "${n.title}" is not anchored to ${n.expect.label}`);
    }

    const status = anchored ? "ANCHORED" : surfaced ? "YES" : "no";
    console.log(
      `${n.persona.padEnd(8)} ${status.padEnd(9)} ${bestSim.toFixed(3).padEnd(7)} ${
        (lexRank >= 0 ? `#${lexRank + 1}` : "-").padEnd(9)
      } ${String(anchors).padEnd(8)} ${n.expect.label}  ["${n.body.slice(0, 42)}..."]`,
    );
    if (surfaced) {
      console.log(`         why: ${surfaced.reasons.map((r) => r.label).join(" | ")}`);
    }
  }

  // Q2: silence must hold for unrelated passages even with enrichment live.
  for (const [book, chapter, from, to] of [["LEV", 13, 1, 8], ["EST", 3, 1, 9]] as const) {
    const result = await runSemanticMargin({
      db, embeddingsStore, provider, crossRefData, bookNames, themes,
      request: {
        book, startChapter: chapter, startVerse: from, endChapter: chapter, endVerse: to,
        passageText: passage(book, chapter, from, to),
      },
    });
    const status = result.semanticNotes.length === 0 ? "(silence ✓)" : `VIOLATED: ${result.semanticNotes.map((s) => s.title).join(", ")}`;
    console.log(`\nQ2 ${book} ${chapter}:${from}-${to} — ${status}`);
    if (result.semanticNotes.length > 0) {
      failures.push(`Q2: ${book} ${chapter} surfaced ${result.semanticNotes.length} persona notes`);
    }
  }

  console.log("\nper persona:");
  for (const [p, s] of byPersona) {
    console.log(`  ${p.padEnd(8)} ${s.hits}/${s.total} expected resurfacings actually surfaced`);
  }
  console.log(
    "\nclaims-eligibility: notes with anchors (extraction only sees anchored notes): " +
      `${PERSONA_NOTES.filter((n) => db.queryAnchorsBySrcId(n.id).length > 0).length}/${PERSONA_NOTES.length}`,
  );

  // Q1 gate: ≥9/10 ref-free quick+sermon expectations (only enforced when
  // enrichment actually ran — without it this is the diagnostic report).
  if (fast) {
    console.log(`\nQ1: ${gatedHits}/${gatedTotal} ref-free quick+sermon expectations surfaced (gate: ≥9/10)`);
    if (gatedHits < 9) failures.push(`Q1: ${gatedHits}/${gatedTotal} below the 9/10 magic gate`);
  }

  db.close();
  embeddingsStore.close();
  rmSync(TMP_LIB, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    for (const f of failures) console.error(`EVAL FAIL: ${f}`);
    process.exit(1);
  }
  console.log(fast ? "EVAL PASS — quick-note magic gate holds (Q1/Q2/E0)" : "diagnostic complete (no gate: enrichment skipped)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
