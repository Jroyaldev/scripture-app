/**
 * Living Margin retrieval eval — B3.5 Gate R5 (the "magic gate", executable).
 * Runs the EXACT shipping code path (runSemanticMargin) against the seeded
 * corpus and asserts the M1-M4 acceptance criteria from
 * tasks/B3.5-margin-retrieval-quality.md:
 *
 *   M1 Silence     — unrelated passages surface ZERO semantic notes
 *   M2 Precision   — related passages surface the right cluster, never distractors
 *   M3 Serendipity — genuine cross-corpus echoes survive the quality bar
 *   M4 Provenance  — every surfaced note carries at least one reason
 *
 * Requires: seed:notes run + embeddings synced (smoke:embed does both checks).
 * Run: npm run eval:margin
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";
import { embedAllNotes } from "../src/host/embeddings-sync.js";
import { runSemanticMargin } from "../src/host/semantic-margin-host.js";
import type { CrossRefData } from "../src/core/margin/types.js";
import type { BookNameMap } from "../src/core/reference/types.js";
import { loadOpenBibleCrossReferences } from "../src/host/cross-reference-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = process.env["LIBRARY_PATH"] ?? resolve(__dirname, "../Library-demo");
const DATA_DIR = resolve(__dirname, "../data/scripture");
const OPENBIBLE_PATH = resolve(__dirname, "../data/cross-references/openbible.jsonl");

const DISTRACTORS = new Set([
  "01SEEDNOTE0000000000000013", // Reading plan Q3
  "01SEEDNOTE0000000000000014", // Small group logistics
  "01SEEDNOTE0000000000000017", // Website migration checklist
  "01SEEDNOTE0000000000000018", // Hospitality supplies
  "01SEEDNOTE0000000000000019", // Budget meeting notes
]);

type GoldenCase = {
  label: string;
  book: string;
  chapter: number;
  from: number;
  to: number;
  /** At least one of these note ids must surface. Empty = M1 silence case. */
  mustSurfaceAnyOf: string[];
  /** Every one of these ids must be absent (distractors are always implied). */
  mustNotSurface?: string[];
  /** When true, ZERO semantic notes are allowed (M1). */
  requireSilence?: boolean;
};

const GOLDEN: GoldenCase[] = [
  {
    label: "M2 ACT 19:1-7 — Spirit/baptism cluster surfaces",
    book: "ACT", chapter: 19, from: 1, to: 7,
    mustSurfaceAnyOf: [
      "01SEEDNOTE0000000000000002", // Acts 2:38 formula
      "01SEEDNOTE0000000000000003", // Samaria anomaly
      "01SEEDNOTE0000000000000012", // Pentecost and Babel
    ],
  },
  {
    label: "M3 GEN 1:1-10 — John-prologue echo survives the quality bar",
    book: "GEN", chapter: 1, from: 1, to: 10,
    mustSurfaceAnyOf: ["01SEEDNOTE0000000000000011"],
  },
  {
    label: "M3 PSA 23:1-6 — shepherd note (John 10/Ezek 34) resurfaces",
    book: "PSA", chapter: 23, from: 1, to: 6,
    mustSurfaceAnyOf: ["01SEEDNOTE0000000000000015"],
  },
  {
    label: "M1 LEV 13:1-8 — silence for unrelated law code",
    book: "LEV", chapter: 13, from: 1, to: 8,
    mustSurfaceAnyOf: [],
    requireSilence: true,
  },
  {
    label: "M1 EST 3:1-9 — silence for unrelated narrative",
    book: "EST", chapter: 3, from: 1, to: 9,
    mustSurfaceAnyOf: [],
    requireSilence: true,
  },
];

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
  const embeddingsStore = new EmbeddingsStore(join(LIBRARY_PATH, ".system/embeddings.sqlite"));
  const provider = new LocalEmbeddingProvider({ cacheDir: resolve(__dirname, "../.model-cache") });
  const bookNames = JSON.parse(
    readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8"),
  ) as BookNameMap;
  const crossRefData = existsSync(OPENBIBLE_PATH)
    ? (loadOpenBibleCrossReferences(OPENBIBLE_PATH) as CrossRefData)
    : null;

  // Ensure embeddings are current for the seeded corpus (incremental, cheap).
  const sync = await embedAllNotes(db, embeddingsStore, provider);
  console.log(`sync: ${sync.embedded} embedded, ${sync.skipped} skipped, ${sync.pruned} pruned`);

  const failures: string[] = [];
  for (const gc of GOLDEN) {
    const result = await runSemanticMargin({
      db,
      embeddingsStore,
      provider,
      crossRefData,
      bookNames,
      request: {
        book: gc.book,
        startChapter: gc.chapter,
        startVerse: gc.from,
        endChapter: gc.chapter,
        endVerse: gc.to,
        passageText: passage(gc.book, gc.chapter, gc.from, gc.to),
      },
    });

    const surfaced = result.semanticNotes;
    const ids = surfaced.map((n) => n.noteId);
    console.log(`\n=== ${gc.label} ===`);
    for (const n of surfaced) {
      console.log(
        `  ${(n.similarity * 100).toFixed(1)}%  ${n.title}\n         why: ${n.reasons.map((r) => r.label).join(" | ") || "(NONE)"}`,
      );
    }
    if (surfaced.length === 0) console.log("  (silence)");

    if (gc.requireSilence && surfaced.length > 0) {
      failures.push(`${gc.label}: expected silence, got ${ids.join(", ")}`);
    }
    if (gc.mustSurfaceAnyOf.length > 0 && !ids.some((id) => gc.mustSurfaceAnyOf.includes(id))) {
      failures.push(`${gc.label}: none of the expected notes surfaced (got: ${ids.join(", ") || "silence"})`);
    }
    for (const id of ids) {
      if (DISTRACTORS.has(id) || gc.mustNotSurface?.includes(id)) {
        const title = db.queryNoteById(id)?.title ?? id;
        failures.push(`${gc.label}: forbidden note surfaced: ${title}`);
      }
    }
    for (const n of surfaced) {
      if (n.reasons.length === 0) {
        failures.push(`${gc.label}: note "${n.title}" surfaced without a reason (M4)`);
      }
    }
  }

  db.close();
  embeddingsStore.close();

  console.log("");
  if (failures.length > 0) {
    for (const f of failures) console.error(`EVAL FAIL: ${f}`);
    process.exit(1);
  }
  console.log("EVAL PASS — magic gate holds (M1-M4)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
